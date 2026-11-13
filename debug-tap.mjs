// weneed-debug-tap — comprehensive wire monitor for the WeNeed DSH plugin.
// Enabled only when plugin config.debugTap === true. Captures BOTH directions
// of every LLM fetch (request messages + response stream) to a persistent JSONL
// log so seed injection and seed-echo into output can be inspected offline.
//
// Entry point: globalThis.fetch (covers DSH intercept path AND the plugin's own
// adapter upstream call). Exit point: the cloned response body (SSE parsed).
// Install: plugin apply() calls install() when config.debugTap===true.
// Uninstall: uninstall() restores the original fetch (or disable config + restart).
// Log: ~/.dsh/weneed-debug.jsonl  (one JSON object per line, dir=request|response).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const LOG_PATH = path.join(os.homedir(), '.dsh', 'weneed-debug.jsonl');
const SEED_HEAD = 'We need understand the current task';
const MAX_HEAD = 160;

function log(entry) {
  try { fs.appendFileSync(LOG_PATH, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n'); } catch {}
}

function channelsOf(m) {
  // Return {content, reasoning} strings for a wire message (string or block array).
  let content = '';
  let reasoning = '';
  if (typeof m?.content === 'string') content = m.content;
  else if (Array.isArray(m?.content)) {
    for (const b of m.content) {
      if (b?.type === 'text' && typeof b.text === 'string') content += b.text;
      else if (b?.type === 'reasoning' && typeof b.text === 'string') reasoning += b.text;
    }
  }
  if (typeof m?.reasoning_content === 'string') reasoning += m.reasoning_content;
  else if (typeof m?.reasoning === 'string') reasoning += m.reasoning;
  return { content, reasoning };
}

function summarizeMessages(msgs) {
  return (Array.isArray(msgs) ? msgs : []).map((m, i) => {
    const { content, reasoning } = channelsOf(m);
    const seedC = content.includes(SEED_HEAD);
    const seedR = reasoning.includes(SEED_HEAD);
    const row = {
      i, role: m?.role, kind: m?.source?.kind,
      contentLen: content.length, reasoningLen: reasoning.length,
      seedInContent: seedC, seedInReasoning: seedR,
      toolCalls: Array.isArray(m?.tool_calls) ? m.tool_calls.length : 0,
      head: content.slice(0, MAX_HEAD),
    };
    // For seed-bearing messages, record the exact channels (verify content=SEED).
    if (seedC || seedR) {
      row.seedContentFull = seedC ? content : undefined;
      row.seedReasoningFull = seedR ? reasoning : undefined;
    }
    return row;
  });
}

function parseSse(text) {
  let content = '', reasoning = '', reasoningDetails = '';
  const tools = [];
  let finish = null;
  for (const line of text.split('\n')) {
    if (!line.startsWith('data:')) continue;
    const data = line.slice(5).trim();
    if (data === '[DONE]') continue;
    let j; try { j = JSON.parse(data); } catch { continue; }
    const choice = Array.isArray(j?.choices) ? j.choices[0] : undefined;
    const d = choice?.delta ?? {};
    if (typeof d.content === 'string') content += d.content;
    if (typeof d.reasoning_content === 'string') reasoning += d.reasoning_content;
    else if (typeof d.reasoning === 'string') reasoning += d.reasoning;
    if (Array.isArray(d.reasoning_details)) reasoningDetails += d.reasoning_details.map(x => x?.text || x?.summary || '').join('');
    if (Array.isArray(d.tool_calls)) for (const t of d.tool_calls) { if (t?.function?.name) tools.push(t.function.name); }
    if (typeof choice?.finish_reason === 'string') finish = choice.finish_reason;
  }
  if (!reasoning && reasoningDetails) reasoning = reasoningDetails;
  return { content, reasoning, tools, finish };
}

export function install() {
  if (globalThis.__weneedDebugTap) return 'already-installed';
  const orig = globalThis.fetch;
  globalThis.__weneedDebugTapOrig = orig;
  let rid = 0;
  globalThis.fetch = function (url, opts) {
    const u = String(url);
    let meta = null;
    try {
      if (opts && typeof opts.body === 'string' && opts.body.includes('"messages"')) {
        const parsed = JSON.parse(opts.body);
        const id = ++rid;
        meta = { id, model: parsed.model };
        log({ dir: 'request', rid: id, url: u.slice(0, 140), model: parsed.model,
          messageCount: (parsed.messages || []).length, messages: summarizeMessages(parsed.messages) });
      }
    } catch (e) { log({ dir: 'request-parse-error', error: String(e?.message || e) }); }
    const p = orig.apply(this, arguments);
    if (meta) {
      Promise.resolve(p).then((resp) => {
        try {
          if (!resp || typeof resp.clone !== 'function') return;
          const clone = resp.clone();
          clone.text().then((text) => {
            try {
              const { content, reasoning, tools, finish } = parseSse(text);
              log({ dir: 'response', rid: meta.id, url: u.slice(0, 140), model: meta.model,
                status: resp.status, finish,
                contentLen: content.length, reasoningLen: reasoning.length,
                seedInContent: content.includes(SEED_HEAD), seedInReasoning: reasoning.includes(SEED_HEAD),
                contentHead: content.slice(0, MAX_HEAD), reasoningHead: reasoning.slice(0, MAX_HEAD),
                contentFull: content.includes(SEED_HEAD) ? content : undefined,
                reasoningFull: reasoning.includes(SEED_HEAD) ? reasoning : undefined,
                tools });
            } catch (e) { log({ dir: 'response-parse-error', rid: meta.id, error: String(e?.message || e) }); }
          }).catch((e) => log({ dir: 'response-read-error', rid: meta.id, error: String(e?.message || e) }));
        } catch (e) { log({ dir: 'response-clone-error', rid: meta.id, error: String(e?.message || e) }); }
      }).catch((e) => log({ dir: 'fetch-error', rid: meta.id, error: String(e?.message || e) }));
    }
    return p;
  };
  globalThis.__weneedDebugTap = true;
  log({ dir: 'tap-installed', logPath: LOG_PATH });
  return 'installed';
}

export function uninstall() {
  if (globalThis.__weneedDebugTapOrig) globalThis.fetch = globalThis.__weneedDebugTapOrig;
  delete globalThis.__weneedDebugTapOrig;
  delete globalThis.__weneedDebugTap;
  log({ dir: 'tap-uninstalled' });
  return 'uninstalled';
}

export const logPath = LOG_PATH;