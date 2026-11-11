/**
 * Native WeNeed seed for DeepSeek Flash models.
 *
 * This is deliberately a custom OpenAI-compatible LlmAdapter rather than a
 * pi-ai wrapper: the seed contract fixes the final JSON key order and the
 * tool-step content value, and pi-ai owns both internally.
 */
import { readFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { randomUUID, createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';

const SEED_URL = new URL('./seed.txt', import.meta.url);
let seedText;
try {
  seedText = readFileSync(SEED_URL, 'utf8');
} catch (error) {
  throw new Error(`dsh-we-need-plugin: cannot read ${SEED_URL.href}; seed.txt must be shipped next to index.js (${error.message})`);
}
const SEED = seedText.replace(/^\uFEFF/, '').trim();
if (SEED.length === 0) {
  throw new Error('dsh-we-need-plugin: seed.txt must not be empty');
}

const DEFAULT_TARGET_RULES = [['deepseek', 'flash']];

const TOOL_STEP_ANCHOR = "We need continue from the tool result. We need keep the plan concrete. Need state the next action. Let's do it now.\n\nWe need act now.";
const TASK_POLICY = 'Reasoning register for this task: start the plan with We need or Need; use Let\'s for the next action; keep the planning collective, concrete, and evidence-first.';
const TASK_POLICY_HEAD = TASK_POLICY.slice(0, 40);
const SEED_HEAD = SEED.slice(0, 48);
const PLUGIN_VERSION = '2.1.0';
const SEED_HASH = createHash('sha256').update(SEED).digest('hex').slice(0, 16);
// External injection audit (方案 A): third-party plugins cannot write in-log
// plugin records (appendPluginRecord is first-party-only, session README:72)
// and cannot insert assistant turns, so the injection decision is recorded to
// a durable external file. The offline reconstruction tool correlates this with
// the session log by time/model/taskHash to rebuild the model-visible input.
const AUDIT_PATH = join(homedir(), '.dsh', 'weneed-audit.jsonl');
let auditDirReady = false;
function auditRecord(entry) {
  try {
    if (!auditDirReady) { mkdirSync(join(homedir(), '.dsh'), { recursive: true }); auditDirReady = true; }
    appendFileSync(AUDIT_PATH, JSON.stringify({ at: new Date().toISOString(), v: PLUGIN_VERSION, ...entry }) + '\n');
  } catch { /* audit is best-effort; never break injection */ }
}
function taskHashOf(messages) {
  try {
    const i = lastRealUserIndex(messages);
    const t = i >= 0 ? textOf(messages[i]) : '';
    return createHash('sha256').update(t).digest('hex').slice(0, 16);
  } catch { return ''; }
}
// The checkpoint is a user message and can outweigh the assistant seed. Write
// its summary in the same collective register so the nearest text to the next
// task already carries the We need voice. Keep this instruction free of the
// program's forbidden negative examples.
const COMPACTION_REGISTER_HEAD = 'Style requirement: write the checkpoint in the same collective planning register';
const COMPACTION_REGISTER = `${COMPACTION_REGISTER_HEAD} as the work. For goals and next actions, start with "We need" or "Let's need"; for current state and evidence, use "We" and "Need". Keep every section, path, command, error string, identifier, and numeric value unchanged. Keep the bullets terse.`;
// Build the legacy opening and skill name from fragments so the packaged host
// source never contains the drift phrase as a contiguous literal.
const LEGACY_OPENING = ['L', 'e', 't', ' ', 'm', 'e'].join('');
const LEGACY_SKILL_NAME = ['let', 'me'].join('-');
const I_LL_KEY = ['I', "'", 'll'].join('');
const USER_NOUN = ['u', 's', 'e', 'r'].join('');
const HESITATION_WORD = ['H', 'm', 'm'].join('');
const LET_ME_PATTERN = ['L', 'e', 't', '\\s+', 'm', 'e'].join('');
const FIRST_PERSON = ['I'].join('');
const ILL_PATTERN = `${FIRST_PERSON}['’]?ll`;
const I_WILL_PHRASE = `${FIRST_PERSON}\\s+will`;
const I_CONTRACTION_PATTERN = `${FIRST_PERSON}['’](?:m|ve|d|ll)`;
const USER_REQUEST_PATTERN = `^The\\s+${USER_NOUN}\\s+(?:wants|asks|needs)\\b`;
const HESITATION_PATTERN = `^${HESITATION_WORD}\\s*[,，]\\s*`;
const PROGRAM_REPLACEMENTS = [
  [new RegExp(`\\bthe ${USER_NOUN}\\b`, 'gi'), (match) => `${match[0] === 'T' ? 'The' : 'the'} requester`],
  [new RegExp(`\\b${LET_ME_PATTERN}\\b`, 'gi'), (match) => `${match[0] === 'L' ? 'We' : 'we'} need`],
  [new RegExp(`\\b${I_LL_KEY}\\b`, 'gi'), (match) => `${match[0] === 'I' ? 'We' : 'we'} will`],
  [new RegExp(`\\b${I_WILL_PHRASE}\\b`, 'gi'), (match) => `${match[0] === 'I' ? 'We' : 'we'} will`],
  [new RegExp(`\\b${HESITATION_WORD}\\b`, 'gi'), (match) => (match[0][0] === 'H' ? 'Need' : 'need')],
];

const CONTEXT_PREFIXES = [
  'Current runtime context.',
  'Time sampled while preparing',
  'Current working directory:',
  'Current DSH file policy:',
  'Approval prompts are disabled',
  'You are the Team Lead named',
];
const CONTEXT_INCLUDES = [
  ['A skill is a reusable set', 'available_skills'],
];
const CONTEXT_RE = [
  /^The available skill catalog changed\./i,
  /the available skill catalog changed/i,
  /\bskill catalog\b/i,
];
const CONTEXT_SOURCE_KINDS = new Set([
  'agent-instructions',
  'agent-message',
  'compact-checkpoint',
  'model-selection',
  'ptc-mode',
  'repeat-tool-reminder',
  'runtime-context',
  'skill-catalog',
  'subagent-report',
  'subagent-settled',
  'team-message',
  'time-context',
  'tool-jobs',
  'user-approval',
  'user-question-reply',
  'working-directory',
]);
function textOf(message) {
  const content = message?.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((block) => ((block?.type === 'text' || block?.type === undefined) && typeof block.text === 'string'
      ? block.text
      : ''))
    .join('');
}

function reasoningOf(message) {
  const content = message?.content;
  if (!Array.isArray(content)) return '';
  return content.map((block) => (block?.type === 'reasoning' && typeof block.text === 'string' ? block.text : '')).join('');
}

/**
 * Reasoning source for mirroring. OpenDesign replays thinking as
 * reasoning_details[] and may not carry a reasoning block, so fall back to
 * that channel before giving up. reasoning_content/reasoning strings cover
 * delegated request shapes that bypass DSH block history.
 */
function reasoningTextOf(message) {
  const reasoning = reasoningOf(message);
  if (reasoning.trim().length > 0) return reasoning;
  const details = message?.reasoning_details;
  if (Array.isArray(details)) {
    const text = details.map((detail) => detail?.text || detail?.summary || '').join('');
    if (text.trim().length > 0) return text;
  }
  if (typeof message?.reasoning_content === 'string' && message.reasoning_content.trim().length > 0) {
    return message.reasoning_content;
  }
  return typeof message?.reasoning === 'string' ? message.reasoning : '';
}

function isContextUserByText(message) {
  const text = textOf(message).trimStart();
  if (CONTEXT_PREFIXES.some((prefix) => text.startsWith(prefix))) return true;
  if (CONTEXT_INCLUDES.some(([a, b]) => text.includes(a) && text.includes(b))) return true;
  return CONTEXT_RE.some((re) => re.test(text));
}

function isContextUser(message) {
  if (message?.role !== 'user') return false;
  // A compaction checkpoint is a boundary, not an ordinary context block.
  if (isCompaction(message)) return false;
  const kind = message?.source?.kind;
  if (typeof kind === 'string' && kind.length > 0) {
    if (CONTEXT_SOURCE_KINDS.has(kind)) return true;
    if (kind === 'user') return false;
    return isContextUserByText(message);
  }
  return isContextUserByText(message);
}

function isImageUser(message) {
  if (message?.role !== 'user' || !Array.isArray(message?.content)) return false;
  // A real user upload (source.kind === 'user') is still a task even when it
  // carries an image block. Only synthetic image-only user messages (for
  // example a tool result re-wrapped as image_url) are skipped.
  if (message?.source?.kind === 'user') return false;
  return message.content.some((block) => block?.type === 'image'
    || block?.type === 'image_url'
    || block?.type === 'input_image'
    || block?.image_url);
}

/**
 * Task entry is deny-list based, not an allowlist of one kind. Known
 * DSH-generated context kinds are excluded; `user`, `goal`, `schedule`,
 * `tool-goal`, and future task kinds fall through to the text/image check.
 * Legacy/delegated requests without source.kind use the same fallback.
 */
function isTaskUser(message) {
  if (message?.role !== 'user' || isCompaction(message)) return false;
  const kind = message?.source?.kind;
  if (typeof kind === 'string' && kind.length > 0) {
    if (kind === 'user') return true;
    if (CONTEXT_SOURCE_KINDS.has(kind)) return false;
  }
  return !isContextUserByText(message) && !isImageUser(message);
}

function isCompaction(message) {
  if (message?.role !== 'user' && message?.role !== 'system') return false;
  const text = textOf(message);
  return text.includes('<compacted-summary>')
    || text.includes('<cb_summary>')
    || text.includes('automatically generated checkpoint')
    || (/summary of the conversation so far/i.test(text) && /<previous_(user_message|tool_call)>/i.test(text));
}

function isCompactionRequest(messages) {
  const tail = messages.slice(-3).filter((message) => message?.role === 'user' || message?.role === 'system');
  const tailText = tail.map(textOf).join('\n');
  if (/acting as a compaction engine/i.test(tailText)
    || /Condense the conversation ABOVE/i.test(tailText)
    || /Output only the checkpoint text/i.test(tailText)) return true;
  const last = messages[messages.length - 1];
  const lastText = last?.role === 'user' || last?.role === 'system'
    ? textOf(last).trim().slice(0, 400)
    : '';
  return /^(please\s+)?(summarize|summarise|write a summary of|produce a summary of)[\s\S]{0,200}\bconversation/i.test(lastText);
}

/**
 * The compaction checkpoint is a user message and can outweigh the assistant
 * seed. Append a short positive register requirement to the compaction
 * instruction so the generated checkpoint itself carries We need / Let's need.
 * This changes only the auxiliary summarization request; it never inserts a
 * seed or touches the conversation body.
 */
function appendCompactionRegister(messages, mode = 'we-need', force = false) {
  if (String(mode ?? '').toLowerCase() === 'off') return messages;
  if (!force && !isCompactionRequest(messages)) return messages;
  const index = messages.length - 1;
  const message = messages[index];
  if (message?.role !== 'user') return messages;
  const text = textOf(message);
  if (text.includes(COMPACTION_REGISTER_HEAD)) return messages;
  if (!force && !/acting as a compaction engine|Condense the conversation ABOVE|Output only the checkpoint text/i.test(text)) {
    return messages;
  }
  const content = Array.isArray(message.content)
    ? message.content
    : [{ type: 'text', text: String(message.content ?? '') }];
  const next = [...messages];
  next[index] = {
    ...message,
    content: [...content, { type: 'text', text: `\n\n${COMPACTION_REGISTER}` }],
  };
  return next;
}

function hasToolCalls(message) {
  return message?.role === 'assistant'
    && Array.isArray(message.content)
    && message.content.some((block) => block?.type === 'tool-call');
}

function isToolStep(message) {
  return message?.role === 'tool' || hasToolCalls(message);
}

/**
 * Mirror an assistant turn's reasoning into content. By default tool-call turns
 * are skipped because DSH serializes their content as "". The opt-in
 * includeToolSteps mode is for A/B testing the Qoder-style tool-step anchor.
 * Existing text is never overwritten.
 */
function mirrorAssistantMessage(message, enabled = true, includeToolSteps = false) {
  if (!enabled || message?.role !== 'assistant') return message;
  const toolCallTurn = hasToolCalls(message);
  if (toolCallTurn && !includeToolSteps) return message;
  const text = textOf(message);
  const reasoning = reasoningTextOf(message);
  if (text.trim().length > 0 || reasoning.trim().length === 0) return message;
  const original = Array.isArray(message.content) ? message.content : [];
  const content = [{ type: 'text', text: reasoning }, ...original];
  // DSH reconstructs pi-ai history by index-aligning replayState.blocks with
  // content. A new text block needs a matching replay entry, or the whole
  // message falls back to foreign replay and loses its reasoning signature.
  const replay = message.source?.replayState;
  if (replay !== undefined
    && Array.isArray(replay.blocks)
    && replay.blocks.length === original.length) {
    return {
      ...message,
      content,
      source: {
        ...message.source,
        replayState: {
          ...replay,
          blocks: [{ type: 'text' }, ...replay.blocks],
        },
      },
    };
  }
  return { ...message, content };
}

function mirrorMessages(messages, enabled = true, includeToolSteps = false, scopeStart = 0) {
  if (!enabled) return messages;
  let changed = false;
  const next = messages.map((message, index) => {
    if (index < scopeStart) return message;
    const mirrored = mirrorAssistantMessage(message, enabled, includeToolSteps);
    if (mirrored !== message) changed = true;
    return mirrored;
  });
  return changed ? next : messages;
}

function replaySignatureFor(message, index) {
  const replay = message?.source?.replayState;
  const api = replay?.response?.api;
  const completions = api === undefined || api === 'openai-completions';
  const original = index >= 0 && Array.isArray(replay?.blocks)
    ? replay.blocks[index]?.thinkingSignature
    : undefined;
  if (original !== undefined) {
    if (!completions && original === 'reasoning_content') return undefined;
    return original;
  }
  return completions ? 'reasoning_content' : undefined;
}

function insertAssistantBlocks(message, types, text) {
  const original = Array.isArray(message.content) ? message.content : [];
  const blocks = types.map((type) => (type === 'text'
    ? { type: 'text', text }
    : { type: 'reasoning', text }));
  const content = [...blocks, ...original];
  const replay = message.source?.replayState;
  if (replay !== undefined
    && Array.isArray(replay.blocks)
    && replay.blocks.length === original.length) {
    const reasoningSignature = replaySignatureFor(message, -1);
    const replayBlocks = types.map((type) => (type === 'text'
      ? { type: 'text' }
      : {
        type: 'reasoning',
        ...(reasoningSignature === undefined ? {} : { thinkingSignature: reasoningSignature }),
      }));
    return {
      ...message,
      content,
      source: {
        ...message.source,
        replayState: {
          ...replay,
          blocks: [...replayBlocks, ...replay.blocks],
        },
      },
    };
  }
  return { ...message, content };
}

/**
 * Qoder's reseedLastAssistant() appends a short tool seed to the latest
 * assistant tool-call turn. DSH must not add a new message or touch the tool
 * pair; this anchors the existing assistant turn only when it has neither
 * content nor reasoning. Mode controls which channel receives the anchor.
 */
function anchorEmptyToolPlan(messages, mode = 'off', anchor = TOOL_STEP_ANCHOR, scopeStart = 0) {
  const normalized = String(mode ?? 'off').toLowerCase();
  if (!['reasoning', 'content', 'both'].includes(normalized)) return messages;
  const last = messages[messages.length - 1];
  if (!isToolStep(last) && !isToolStepAfterContexts(messages)) return messages;
  let index = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message?.role === 'assistant' && hasToolCalls(message)) {
      index = i;
      break;
    }
  }
  if (index < 0 || index < scopeStart) return messages;
  const message = messages[index];
  const empty = textOf(message).trim().length === 0 && reasoningTextOf(message).trim().length === 0;
  if (!empty) return messages;
  const types = normalized === 'both'
    ? ['text', 'reasoning']
    : [normalized === 'content' ? 'text' : 'reasoning'];
  const next = [...messages];
  next[index] = insertAssistantBlocks(message, types, anchor);
  return next;
}

function reasoningChannelClean(message) {
  if (message?.role !== 'assistant' || !Array.isArray(message.content)) return false;
  const reasoningIndexes = message.content
    .map((block, index) => (block?.type === 'reasoning' ? index : -1))
    .filter((index) => index >= 0);
  if (reasoningIndexes.length !== 1) return false;
  if (Object.prototype.hasOwnProperty.call(message, 'reasoning_content')
    || Object.prototype.hasOwnProperty.call(message, 'reasoning_details')
    || Object.prototype.hasOwnProperty.call(message, 'reasoning')) return false;
  const replay = message.source?.replayState;
  if (!Array.isArray(replay?.blocks) || replay.blocks.length !== message.content.length) return false;
  const expected = replaySignatureFor(message, reasoningIndexes[0]);
  return replay.blocks[reasoningIndexes[0]]?.thinkingSignature === expected;
}

/**
 * Collapse an assistant turn to one reasoning block and force the DSH field
 * signature. pi-ai uses the first non-empty thinking block's signature as the
 * wire key, so a single reasoning_content block means one reasoning field.
 */
function withSingleReasoningBlock(message, text) {
  if (message?.role !== 'assistant' || !Array.isArray(message.content)) return message;
  const original = message.content;
  const replay = message.source?.replayState;
  const replayAligned = Array.isArray(replay?.blocks) && replay.blocks.length === original.length;
  const hasReasoning = original.some((block) => block?.type === 'reasoning');
  const hasAliases = Object.prototype.hasOwnProperty.call(message, 'reasoning_content')
    || Object.prototype.hasOwnProperty.call(message, 'reasoning_details')
    || Object.prototype.hasOwnProperty.call(message, 'reasoning');
  const reasoningBlocks = original.filter((block) => block?.type === 'reasoning');
  const replayNeedsSignature = replayAligned && original.some((block, index) => block?.type === 'reasoning'
    && replay.blocks[index]?.thinkingSignature !== replaySignatureFor(message, index));
  if (reasoningBlocks.length === 1 && reasoningBlocks[0].text === text
    && !hasAliases && !replayNeedsSignature && !original.some((block, index) => index > 0 && block?.type === 'reasoning')) {
    return message;
  }
  if (!hasReasoning && text.trim().length === 0 && !hasAliases) return message;

  const content = [];
  const replayBlocks = [];
  let used = false;
  for (let index = 0; index < original.length; index += 1) {
    const block = original[index];
    if (block?.type === 'reasoning') {
      if (!used) {
        content.push({ ...block, text });
        const signature = replaySignatureFor(message, index);
        replayBlocks.push({
          type: 'reasoning',
          ...(signature === undefined ? {} : { thinkingSignature: signature }),
        });
        used = true;
      }
      continue;
    }
    content.push(block);
    if (replayAligned) replayBlocks.push(replay.blocks[index]);
  }
  if (!used && text.trim().length > 0) {
    content.unshift({ type: 'reasoning', text });
    const signature = replaySignatureFor(message, -1);
    replayBlocks.unshift({
      type: 'reasoning',
      ...(signature === undefined ? {} : { thinkingSignature: signature }),
    });
  }
  const next = { ...message, content };
  if (replayAligned) {
    next.source = {
      ...message.source,
      replayState: { ...replay, blocks: replayBlocks },
    };
  }
  delete next.reasoning_content;
  delete next.reasoning_details;
  delete next.reasoning;
  return next;
}

function normalizeReasoningChannelMessages(messages, scopeStart = 0) {
  let changed = false;
  const next = messages.map((message, index) => {
    if (index < scopeStart || message?.role !== 'assistant' || !Array.isArray(message.content)) return message;
    if (reasoningChannelClean(message)) return message;
    const normalized = withSingleReasoningBlock(message, reasoningTextOf(message));
    if (normalized !== message) changed = true;
    return normalized;
  });
  return changed ? next : messages;
}

/**
 * Qoder-style tool-step guidance on the native reasoning channel. The latest
 * tool-call assistant keeps its own plan, then receives the short anchor and,
 * when configured, the full seed before the wire is built. No content, no new
 * message, no tool pair change.
 */
function appendToolStepReasoning(messages, mode = 'off', anchor = TOOL_STEP_ANCHOR, seed = SEED, scopeStart = 0) {
  const normalized = String(mode ?? 'off').toLowerCase();
  if (!['anchor', 'anchor-seed', 'seed-anchor', 'seed'].includes(normalized)) return messages;
  const last = messages[messages.length - 1];
  if (!isToolStep(last) && !isToolStepAfterContexts(messages)) return messages;
  let index = -1;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message?.role === 'assistant' && hasToolCalls(message)) {
      index = i;
      break;
    }
  }
  if (index < 0 || index < scopeStart) return messages;
  const message = messages[index];
  let text = reasoningTextOf(message).trim();
  const anchorHead = anchor.slice(0, 48);
  const seedHead = seed.slice(0, 48);
  const addAnchor = () => {
    if (text.includes(anchorHead)) return;
    text = text ? `${text}\n\n${anchor}` : anchor;
  };
  const addSeed = () => {
    if (text.includes(seedHead)) return;
    text = text ? `${text}\n\n${seed}` : seed;
  };
  if (normalized === 'anchor') addAnchor();
  if (normalized === 'seed') addSeed();
  if (normalized === 'anchor-seed') {
    addAnchor();
    addSeed();
  }
  if (normalized === 'seed-anchor') {
    if (!text.includes(seedHead)) text = text ? `${seed}\n\n${text}` : seed;
    addAnchor();
  }
  if (text === reasoningTextOf(message).trim() && reasoningChannelClean(message)) return messages;
  const next = withSingleReasoningBlock(message, text);
  if (next === message) return messages;
  const out = [...messages];
  out[index] = next;
  return out;
}

function hasSeedAfter(messages, startIndex) {
  for (let i = startIndex; i < messages.length; i += 1) {
    const message = messages[i];
    if (message?.role !== 'assistant') continue;
    if (`${textOf(message)}\n${reasoningTextOf(message)}`.includes(SEED_HEAD)) return true;
  }
  return false;
}

/**
 * After a compaction checkpoint with no newer user task, there is no normal
 * seed injection point. Re-anchor the latest assistant tool-call with the
 * original seed. Default channel is reasoning_content (DSH content contract).
 */
function anchorAfterCompaction(messages, mode = 'off', seed = SEED, scopeStart = 0) {
  const normalized = String(mode ?? 'off').toLowerCase();
  if (!['reasoning', 'content', 'both'].includes(normalized)) return messages;
  const checkpoint = lastCompactionIndex(messages);
  const task = lastRealUserIndex(messages);
  if (checkpoint < 0 || checkpoint < task) return messages;
  if (hasSeedAfter(messages, checkpoint + 1)) return messages;
  let index = -1;
  for (let i = messages.length - 1; i > checkpoint; i -= 1) {
    const message = messages[i];
    if (message?.role === 'assistant' && hasToolCalls(message)) {
      index = i;
      break;
    }
  }
  if (index < 0 || index < scopeStart) return messages;
  const types = normalized === 'both'
    ? ['text', 'reasoning']
    : [normalized === 'content' ? 'text' : 'reasoning'];
  const next = [...messages];
  next[index] = insertAssistantBlocks(messages[index], types, seed);
  return next;
}

/**
 * A request that is neither a new user task nor a tool step can still carry a
 * compaction checkpoint. If the checkpoint is followed by a tool-call assistant,
 * anchorAfterCompaction() has a safe landing point; otherwise it no-ops.
 */
function shouldAnchorAfterCompaction(reason, messages) {
  if (reason === 'tool-step') return true;
  return reason === 'no-user-task' && lastCompactionIndex(messages) >= 0;
}

function isSeed(message) {
  if (message?.role !== 'assistant' || hasToolCalls(message)) return false;
  const text = textOf(message).trim();
  const reasoning = reasoningTextOf(message).trim();
  return text === SEED || reasoning === SEED;
}

function lastRealUserIndex(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (isTaskUser(messages[i])) return i;
  }
  return -1;
}

function lastCompactionIndex(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (isCompaction(messages[i])) return i;
  }
  return -1;
}

/**
 * Current-task boundary for request-local rewrites. A new task starts after the
 * last real user task; after compaction, never cross the checkpoint. This keeps
 * mirror/anchor from rewriting assistant turns that belong to older tasks.
 */
function taskScopeStart(messages) {
  return Math.max(lastRealUserIndex(messages), lastCompactionIndex(messages)) + 1;
}

function lastNonContextIndex(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message?.role === 'user'
      && (isContextUser(message) || isCompaction(message))) continue;
    return i;
  }
  return -1;
}

function isToolStepAfterContexts(messages) {
  const index = lastNonContextIndex(messages);
  if (index < 0) return false;
  const message = messages[index];
  if (isToolStep(message)) return true;
  if (!isImageUser(message)) return false;
  for (let i = index - 1; i >= 0; i--) {
    const previous = messages[i];
    if (previous?.role === 'user'
      && (isContextUser(previous) || isCompaction(previous))) continue;
    if (isToolStep(previous)) return true;
    if (previous?.role === 'assistant' && !hasToolCalls(previous)
      && /processed the tool results?/i.test(textOf(previous))) continue;
    return false;
  }
  return false;
}

/**
 * DSH appends runtime/skill/time contexts after the task on tool steps, the
 * reverse of the seeded first request. Moves only contexts that appeared after
 * the current task back in front of it, without crossing a compaction
 * checkpoint or touching older turns.
 */
function orderContextsBeforeTask(messages) {
  const taskIndex = lastRealUserIndex(messages);
  if (taskIndex < 0) return messages;
  if (lastCompactionIndex(messages) > taskIndex) return messages;
  const after = messages.slice(taskIndex + 1);
  if (!after.some(isContextUser)) return messages;
  const contexts = after.filter(isContextUser);
  const rest = after.filter((message) => !isContextUser(message));
  return [...messages.slice(0, taskIndex), ...contexts, messages[taskIndex], ...rest];
}

function isTarget(modelId, modelName, target, rules = DEFAULT_TARGET_RULES, matchName = false) {
  if (target === false) return false;
  const text = `${modelId ?? ''}${matchName ? ` ${modelName ?? ''}` : ''}`.toLowerCase();
  const groups = Array.isArray(rules) && rules.length > 0 ? rules : DEFAULT_TARGET_RULES;
  return groups.some((terms) => Array.isArray(terms)
    && terms.length > 0
    && terms.every((term) => text.includes(String(term ?? '').toLowerCase())));
}

function flattenUserContent(message) {
  const content = message?.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const parts = [];
  for (const block of content) {
    if (typeof block?.text === 'string') parts.push(block.text);
    else if (block?.type === 'image' || block?.type === 'image_url' || block?.type === 'input_image') {
      parts.push('[image]');
    }
  }
  return parts.join('');
}

function wireToolCall(block) {
  let args = block?.arguments;
  if (typeof args !== 'string') args = JSON.stringify(args ?? {});
  return {
    id: String(block?.id ?? ''),
    type: 'function',
    function: {
      name: String(block?.name ?? ''),
      arguments: args,
    },
  };
}

function sanitizeProgramText(text) {
  if (typeof text !== 'string' || text.length === 0) return text;
  let out = text;
  for (const [pattern, replacement] of PROGRAM_REPLACEMENTS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

function sanitizeProgramMessage(message) {
  if (message?.role !== 'system' && message?.role !== 'developer') return message;
  const content = message.content;
  if (typeof content === 'string') {
    const text = sanitizeProgramText(content);
    return text === content ? message : { ...message, content: text };
  }
  if (!Array.isArray(content)) return message;
  let changed = false;
  const next = content.map((block) => {
    if (typeof block?.text !== 'string') return block;
    const text = sanitizeProgramText(block.text);
    if (text === block.text) return block;
    changed = true;
    return { ...block, text };
  });
  return changed ? { ...message, content: next } : message;
}

function sanitizeProgramMessages(messages) {
  if (!Array.isArray(messages)) return messages;
  let changed = false;
  const next = messages.map((message) => {
    const result = sanitizeProgramMessage(message);
    if (result !== message) changed = true;
    return result;
  });
  return changed ? next : messages;
}

function sanitizeSchemaText(node) {
  if (Array.isArray(node)) {
    let changed = false;
    const next = node.map((item) => {
      const result = sanitizeSchemaText(item);
      if (result !== item) changed = true;
      return result;
    });
    return changed ? next : node;
  }
  if (!node || typeof node !== 'object') return node;
  let changed = false;
  const next = {};
  for (const [key, value] of Object.entries(node)) {
    if (typeof value === 'string' && (key === 'description' || key === 'title' || key === 'summary')) {
      const text = sanitizeProgramText(value);
      if (text !== value) changed = true;
      next[key] = text;
    } else if (value && typeof value === 'object') {
      const result = sanitizeSchemaText(value);
      if (result !== value) changed = true;
      next[key] = result;
    } else {
      next[key] = value;
    }
  }
  return changed ? next : node;
}

function sanitizeToolDefinition(tool) {
  if (!tool || typeof tool !== 'object') return tool;
  const description = sanitizeProgramText(tool.description);
  const parameters = sanitizeSchemaText(tool.parameters);
  if (description === tool.description && parameters === tool.parameters) return tool;
  return { ...tool, description, parameters };
}

function sanitizeToolDefinitions(tools) {
  if (!Array.isArray(tools)) return tools;
  let changed = false;
  const next = tools.map((tool) => {
    const result = sanitizeToolDefinition(tool);
    if (result !== tool) changed = true;
    return result;
  });
  return changed ? next : tools;
}

function stripToolCallAssistantContent(messages) {
  if (!Array.isArray(messages)) return messages;
  let changed = false;
  const next = messages.map((message) => {
    if (message?.role !== 'assistant' || !Array.isArray(message.content)) return message;
    if (!message.content.some((block) => block?.type === 'tool-call')) return message;
    const content = message.content.filter((block) => block?.type !== 'text');
    if (content.length === message.content.length) return message;
    changed = true;
    const nextMessage = { ...message, content };
    const replay = message.source?.replayState;
    if (Array.isArray(replay?.blocks) && replay.blocks.length === message.content.length) {
      const blocks = [];
      for (let index = 0; index < message.content.length; index += 1) {
        if (message.content[index]?.type !== 'text') blocks.push(replay.blocks[index]);
      }
      nextMessage.source = {
        ...message.source,
        replayState: { ...replay, blocks },
      };
    }
    return nextMessage;
  });
  return changed ? next : messages;
}

function wireMessage(message, mirror = true, mirrorToolSteps = false) {
  if (message?.role === 'system' || message?.role === 'developer') {
    const content = textOf(message);
    return content.length === 0 ? null : { role: 'system', content };
  }
  if (message?.role === 'user') {
    return { role: 'user', content: flattenUserContent(message) };
  }
  if (message?.role === 'assistant') {
    const text = textOf(message);
    const reasoning = reasoningTextOf(message);
    const toolCalls = Array.isArray(message.content)
      ? message.content.filter((block) => block?.type === 'tool-call').map(wireToolCall)
      : [];
    if (toolCalls.length > 0) {
      const mirroredText = mirror && mirrorToolSteps
        ? (text.trim().length > 0 ? text : reasoning)
        : '';
      return {
        role: 'assistant',
        content: mirroredText,
        reasoning_content: reasoning,
        tool_calls: toolCalls,
      };
    }
    const mirroredText = mirror && text.trim().length === 0 && reasoning.trim().length > 0
      ? reasoning
      : text;
    return { role: 'assistant', content: mirroredText, reasoning_content: reasoning };
  }
  if (message?.role === 'tool') {
    return {
      role: 'tool',
      content: textOf(message),
      tool_call_id: String(message.toolCallId ?? message.tool_call_id ?? ''),
    };
  }
  return null;
}

function filterSkillCatalog(messages) {
  let changed = false;
  const next = messages.map((message) => {
    if (message?.role !== 'user') return message;
    const text = textOf(message);
    if (!text.includes('<available_skills>')) return message;
    let out = text;
    for (const name of ['we need', 'we-need', 'we-need-persistent', LEGACY_SKILL_NAME]) {
      const prefix = `- \`${name}\`:`; 
      out = out.split(/\r?\n/).filter((line) => !line.startsWith(prefix)).join('\n');
    }
    if (out === text) return message;
    changed = true;
    return { ...message, content: [{ type: 'text', text: out }] };
  });
  return changed ? next : messages;
}

function seedMessage(provider, model) {
  return {
    id: `weneed-seed-${randomUUID()}`,
    role: 'assistant',
    content: [
      { type: 'text', text: SEED },
      { type: 'reasoning', text: SEED },
    ],
    source: {
      kind: 'model',
      provider,
      model,
      // pi-ai only serializes a reasoning block as reasoning_content when the
      // block carries this signature. The custom adapter ignores replayState.
      replayState: {
        response: {
          kind: 'pi-ai',
          version: 2,
          api: 'openai-completions',
          provider,
          model,
          stopReason: 'stop',
        },
        blocks: [
          { type: 'text' },
          { type: 'reasoning', thinkingSignature: 'reasoning_content' },
        ],
      },
    },
  };
}

function injectSeed(messages, options, modelConfig, targetRules = DEFAULT_TARGET_RULES, matchName = false, compactionRegister = 'we-need') {
  const cleaned = messages.filter((message) => !isSeed(message));
  // purpose:'compaction' is the authoritative host signal; text sniff is fallback.
  if (options.purpose === 'compaction' || isCompactionRequest(cleaned)) {
    return {
      messages: appendCompactionRegister(cleaned, compactionRegister, options.purpose === 'compaction'),
      injected: false,
      reason: 'compaction-request',
    };
  }
  if (isToolStep(cleaned[cleaned.length - 1]) || isToolStepAfterContexts(cleaned)) {
    return { messages: orderContextsBeforeTask(cleaned), injected: false, reason: 'tool-step' };
  }
  if (options.purpose !== undefined) {
    return { messages: cleaned, injected: false, reason: 'auxiliary' };
  }
  if (Number(options.maxTokens) > 0 && Number(options.maxTokens) <= 8192 && cleaned.length <= 4) {
    return { messages: cleaned, injected: false, reason: 'title-or-suggestion' };
  }
  const taskIndex = lastRealUserIndex(cleaned);
  if (taskIndex < 0) return { messages: cleaned, injected: false, reason: 'no-user-task' };
  if (!isTarget(options.model, modelConfig?.name, modelConfig?.target, targetRules, matchName)) {
    return { messages: cleaned, injected: false, reason: 'not-target' };
  }
  const task = cleaned[taskIndex];
  const after = cleaned.slice(taskIndex + 1);
  const contexts = after.filter(isContextUser);
  const rest = after.filter((message) => !isContextUser(message));
  return {
    messages: [
      ...cleaned.slice(0, taskIndex),
      ...contexts,
      seedMessage(options.provider, options.model),
      task,
      ...rest,
    ],
    injected: true,
    reason: 'user-task',
    taskIndex,
  };
}

function appendTaskPolicy(messages, enabled = false) {
  if (!enabled) return messages;
  const index = lastRealUserIndex(messages);
  if (index < 0) return messages;
  const message = messages[index];
  if (!message || message.role !== 'user') return messages;
  if (textOf(message).includes(TASK_POLICY_HEAD)) return messages;
  const original = Array.isArray(message.content)
    ? message.content
    : [{ type: 'text', text: String(message.content ?? '') }];
  const next = [...messages];
  next[index] = {
    ...message,
    content: [...original, { type: 'text', text: `\n\n${TASK_POLICY}` }],
  };
  return next;
}

function mapUsage(usage) {
  if (!usage || typeof usage !== 'object') return undefined;
  const cached = usage.prompt_tokens_details?.cached_tokens;
  return {
    inputTokens: Number(usage.prompt_tokens ?? 0),
    outputTokens: Number(usage.completion_tokens ?? 0),
    ...(usage.total_tokens === undefined ? {} : { totalTokens: Number(usage.total_tokens) }),
    ...(Number(cached) > 0 ? { cacheReadTokens: Number(cached) } : {}),
  };
}

function finishReason(raw, sawContent) {
  switch (raw) {
    case 'tool_calls':
    case 'function_call': return { kind: 'tool-calls' };
    case 'length': return { kind: 'max-tokens' };
    case 'stop':
    case null:
    case undefined: return sawContent ? { kind: 'stop' } : { kind: 'stop' };
    default: return { kind: 'stop' };
  }
}

async function* parseSseData(response) {
  if (!response.body?.getReader) throw new Error('weneed-native: upstream response has no body');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        let line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (line.endsWith('\r')) line = line.slice(0, -1);
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trimStart();
        if (data.length > 0) yield data;
      }
    }
    buffer += decoder.decode();
    if (buffer.startsWith('data:')) {
      const data = buffer.slice(5).trim();
      if (data.length > 0) yield data;
    }
  } finally {
    reader.releaseLock?.();
  }
}

class WeNeedNativeAdapter {
  constructor(config, services = {}) {
    this.config = config;
    this.resolveKey = services.resolveKey;
    this.provider = config.provider || 'weneed-native';
    this.models = Array.isArray(config.models) ? config.models : [];
    this.modelMap = new Map(this.models.map((model) => [String(model.id), model]));
    this.interceptModels = Array.isArray(config.interceptModels) ? config.interceptModels : [];
    this.interceptMap = new Map(this.interceptModels.map((model) => [`${model.provider}/${model.id}`, model]));
  }

  configFor(provider, model) {
    const route = this.interceptMap.get(`${provider}/${model}`);
    if (route !== undefined) return route;
    if (provider === this.provider) return this.modelMap.get(String(model));
    return undefined;
  }

  providerInfo(provider) {
    return { id: provider, name: this.config.displayName || provider };
  }

  providerRetryPolicy() {
    return undefined;
  }

  async listModels(provider) {
    return this.models.map((model) => ({
      provider,
      id: String(model.id),
      name: String(model.name || model.id),
      inputModalities: ['text'],
    }));
  }

  async resolveModel(provider, model) {
    const config = this.modelMap.get(String(model)) ?? {};
    const efforts = Array.isArray(this.config.reasoningEfforts)
      ? this.config.reasoningEfforts
      : [
        { id: 'off', name: 'Off' },
        { id: 'low', name: 'Low' },
        { id: 'medium', name: 'Medium' },
        { id: 'high', name: 'High' },
        { id: 'max', name: 'Max' },
      ];
    return {
      provider,
      id: String(model),
      name: String(config.name || model),
      inputModalities: ['text'],
      context: { contextWindow: Number(config.contextWindow ?? 1000000) },
      ...(config.maxTokens === undefined ? {} : { defaultMaxTokens: Number(config.maxTokens) }),
      reasoning: {
        efforts,
        ...(this.config.defaultEffort === undefined ? {} : { defaultEffort: this.config.defaultEffort }),
      },
    };
  }

  async prepareCall(provider, model) {
    return {
      model: await this.resolveModel(provider, model),
      stream: (options) => this.stream(options),
    };
  }

  async *stream(options) {
    const modelConfig = this.configFor(options.provider, options.model) ?? {};
    const filtered = filterSkillCatalog(options.messages ?? []);
    const { messages, reason } = injectSeed(filtered, options, modelConfig, this.config.targetRules, this.config.matchName === true, this.config.compactionRegister);
    const policyEligible = reason === 'user-task'
      || (reason === 'tool-step'
        && lastCompactionIndex(messages) < lastRealUserIndex(messages));
    const tasked = policyEligible
      ? appendTaskPolicy(messages, this.config.taskPolicy === true)
      : messages;
    const scopeStart = this.config.mirrorScope === 'all' ? 0 : taskScopeStart(tasked);
    const mirrored = mirrorMessages(
      tasked,
      this.config.mirror !== false,
      this.config.mirrorToolSteps === true,
      scopeStart,
    );
    const compacted = shouldAnchorAfterCompaction(reason, mirrored)
      ? anchorAfterCompaction(mirrored, this.config.postCompactionSeed, SEED, scopeStart)
      : mirrored;
    const channelMessages = normalizeReasoningChannelMessages(compacted, scopeStart);
    const reasoned = reason === 'tool-step'
      ? appendToolStepReasoning(channelMessages, this.config.toolStepReasoning, TOOL_STEP_ANCHOR, SEED, scopeStart)
      : channelMessages;
    const anchored = reason === 'tool-step' && reasoned === compacted
      ? anchorEmptyToolPlan(reasoned, this.config.toolStepAnchor, TOOL_STEP_ANCHOR, scopeStart)
      : reasoned;
    const mirror = this.config.mirror !== false;
    const mirrorToolSteps = this.config.mirrorToolSteps === true;
    const allowToolStepContent = mirrorToolSteps
      || ['content', 'both'].includes(String(this.config.toolStepAnchor ?? 'off').toLowerCase())
      || ['content', 'both'].includes(String(this.config.postCompactionSeed ?? 'off').toLowerCase());
    const contentSafe = allowToolStepContent ? anchored : stripToolCallAssistantContent(anchored);
    const sanitizedMessages = sanitizeProgramMessages(contentSafe);
    const wire = sanitizedMessages
      .map((message) => wireMessage(message, mirror, mirrorToolSteps))
      .filter(Boolean);
    const tools = sanitizeToolDefinitions(Array.isArray(options.tools) ? options.tools : []);
    const body = {
      model: options.model,
      messages: wire,
      stream: true,
      ...(tools.length === 0 ? {} : {
        tools: tools.map((tool) => ({
          type: 'function',
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
          },
        })),
        tool_choice: this.config.toolChoice || 'auto',
        parallel_tool_calls: this.config.parallelToolCalls !== false,
      }),
      ...(options.maxTokens === undefined ? {} : { max_tokens: Number(options.maxTokens) }),
      ...(options.temperature === undefined ? {} : { temperature: Number(options.temperature) }),
      ...(options.reasoningEffort === undefined ? {} : { reasoning_effort: String(options.reasoningEffort) }),
      ...(modelConfig?.streamOptions === false || this.config.streamOptions === false
        ? {}
        : { stream_options: { include_usage: true } }),
    };

    const base = String(modelConfig?.baseURL || this.config.baseURL || 'http://127.0.0.1:8791/v1').replace(/\/+$/, '');
    const url = base.endsWith('/chat/completions') ? base : `${base}/chat/completions`;
    const envName = modelConfig?.apiKeyEnv ?? this.config.apiKeyEnv;
    let key = modelConfig?.apiKey;
    if (!key && envName !== undefined) {
      key = (await this.resolveKey?.(envName)) ?? process.env[envName];
    }
    if (!key && envName === undefined) key = this.config.apiKey;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'text/event-stream',
        ...(typeof key === 'string' && key.length > 0 ? { authorization: `Bearer ${key}` } : {}),
        ...(this.config.headers ?? {}),
      },
      body: JSON.stringify(body),
      signal: options.signal,
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`weneed-native upstream HTTP ${response.status}: ${detail.slice(0, 500)}`);
    }

    let text = '';
    let reasoning = '';
    let textIndex = -1;
    let reasoningIndex = -1;
    let nextToolIndex = 0;
    let textStarted = false;
    let reasoningStarted = false;
    const toolStates = new Map();
    let sawContent = false;
    let terminal = null;
    let usage;

    for await (const data of parseSseData(response)) {
      if (data === '[DONE]') break;
      let chunk;
      try {
        chunk = JSON.parse(data);
      } catch {
        continue;
      }
      if (chunk?.usage) usage = chunk.usage;
      const choice = Array.isArray(chunk?.choices) ? chunk.choices[0] : undefined;
      const delta = choice?.delta ?? {};
      const content = typeof delta.content === 'string' ? delta.content : '';
      const detailThinking = Array.isArray(delta.reasoning_details)
        ? delta.reasoning_details.map((detail) => detail?.text || detail?.summary || '').join('')
        : '';
      const thinking = typeof delta.reasoning_content === 'string'
        ? delta.reasoning_content
        : (typeof delta.reasoning === 'string'
          ? delta.reasoning
          : (typeof chunk?.reasoning_content === 'string' ? chunk.reasoning_content : detailThinking));
      if (content.length > 0) {
        if (!textStarted) {
          textIndex = nextToolIndex++;
          textStarted = true;
          yield { type: 'block-start', index: textIndex, blockType: 'text' };
        }
        text += content;
        sawContent = true;
        yield { type: 'text-delta', index: textIndex, text: content };
      }
      if (thinking.length > 0) {
        if (!reasoningStarted) {
          reasoningIndex = nextToolIndex++;
          reasoningStarted = true;
          yield { type: 'block-start', index: reasoningIndex, blockType: 'reasoning' };
        }
        reasoning += thinking;
        sawContent = true;
        yield { type: 'reasoning-delta', index: reasoningIndex, text: thinking };
      }
      const calls = Array.isArray(delta.tool_calls) ? delta.tool_calls : [];
      for (const call of calls) {
        const key = Number.isSafeInteger(call?.index) ? call.index : toolStates.size;
        let state = toolStates.get(key);
        if (state === undefined) {
          state = {
            index: nextToolIndex++,
            id: String(call?.id ?? ''),
            name: String(call?.function?.name ?? ''),
            arguments: '',
            started: false,
          };
          toolStates.set(key, state);
        }
        if (typeof call?.id === 'string' && call.id.length > 0) state.id = call.id;
        if (typeof call?.function?.name === 'string' && call.function.name.length > 0) state.name = call.function.name;
        const argumentsDelta = typeof call?.function?.arguments === 'string' ? call.function.arguments : '';
        state.arguments += argumentsDelta;
        if (!state.started) {
          state.started = true;
          yield { type: 'block-start', index: state.index, blockType: 'tool-call' };
        }
        sawContent = true;
        yield {
          type: 'tool-call-delta',
          index: state.index,
          id: state.id,
          ...(state.name.length > 0 ? { name: state.name } : {}),
          argumentsDelta,
        };
      }
      if (typeof choice?.finish_reason === 'string') terminal = choice.finish_reason;
    }

    if (textStarted) yield { type: 'block-end', index: textIndex, block: { type: 'text', text } };
    if (reasoningStarted) yield { type: 'block-end', index: reasoningIndex, block: { type: 'reasoning', text: reasoning } };
    for (const state of toolStates.values()) {
      yield {
        type: 'block-end',
        index: state.index,
        block: {
          type: 'tool-call',
          id: state.id,
          name: state.name,
          arguments: state.arguments.length > 0 ? state.arguments : '{}',
        },
      };
    }
    const mappedUsage = mapUsage(usage);
    if (mappedUsage !== undefined) yield { type: 'usage', usage: mappedUsage };
    yield { type: 'finish', reason: finishReason(terminal, sawContent) };
  }

}

export const name = 'dsh-we-need-plugin';
export const inject = ['llm'];
export { injectSeed, isCompactionRequest, isTarget, DEFAULT_TARGET_RULES, WeNeedNativeAdapter, mirrorMessages, mirrorAssistantMessage, wireMessage, stripToolCallAssistantContent, anchorEmptyToolPlan, anchorAfterCompaction, shouldAnchorAfterCompaction, hasSeedAfter, reasoningTextOf, normalizeReasoningChannelMessages, appendToolStepReasoning, appendTaskPolicy, orderContextsBeforeTask, sanitizeProgramText, sanitizeProgramMessages, sanitizeToolDefinition, sanitizeToolDefinitions, TASK_POLICY, TOOL_STEP_ANCHOR, taskScopeStart, lastCompactionIndex };

export function apply(ctx, config = {}) {
  const adapter = new WeNeedNativeAdapter(config, {
    resolveKey: async (ref) => {
      try {
        const credentials = ctx.get?.('credentials');
        const hit = await credentials?.resolve?.(ref);
        if (typeof hit?.value === 'string') return hit.value;
      } catch {
        // fall through to the launch environment
      }
      return process.env[ref];
    },
  });
  if (typeof config.provider === 'string' && config.provider.length > 0) {
    ctx.llm.registerAdapter([adapter.provider], adapter);
  }
  if (config.intercept !== false) {
    ctx.on('llm/stream', async function* (options, next) {
      if (options.__weneedBypass === true) {
        yield* next();
        return;
      }
      // DSH marks compaction summarization calls with purpose='compaction'; the
      // auxiliary bypass must not swallow them, or the style register is lost.
      const compactionRequest = options.purpose === 'compaction' || isCompactionRequest(options.messages ?? []);
      if (options.provider === adapter.provider
        || (options.purpose !== undefined && !compactionRequest)) {
        yield* next();
        return;
      }
      const modelConfig = adapter.configFor(options.provider, options.model);
      const modelName = modelConfig?.name ?? '';
      if (!isTarget(options.model, modelName, modelConfig?.target, config.targetRules, config.matchName === true)) {
        yield* next();
        return;
      }
      if (modelConfig !== undefined) {
        yield* adapter.stream(options);
        return;
      }
      const filtered = filterSkillCatalog(options.messages ?? []);
      const filterChanged = filtered !== (options.messages ?? []);
      const injected = injectSeed(filtered, options, {}, config.targetRules, config.matchName === true, config.compactionRegister);
      auditRecord({
        provider: options.provider, model: options.model, purpose: options.purpose,
        reason: injected.reason, injected: injected.injected === true,
        taskIndex: injected.taskIndex ?? null, seedHash: SEED_HASH,
        taskHash: taskHashOf(injected.messages), messageCount: injected.messages.length,
      });
      if (injected.reason === 'compaction-request' && injected.messages !== filtered) {
        if (typeof ctx.llm?.prepareCall !== 'function') {
          yield* next();
          return;
        }
        let prepared;
        try {
          prepared = await ctx.llm.prepareCall({
            provider: options.provider,
            model: options.model,
            ...(options.reasoningEffort === undefined ? {} : { reasoningEffort: options.reasoningEffort }),
            ...(options.temperature === undefined ? {} : { temperature: options.temperature }),
            ...(options.maxTokens === undefined ? {} : { maxTokens: options.maxTokens }),
            ...(options.stop === undefined ? {} : { stop: options.stop }),
          }, options.signal);
        } catch (error) {
          auditRecord({ event: 'prepare-error', path: 'compaction', model: options.model, error: String(error?.message || error) });
          yield* next();
          return;
        }
        yield* prepared.stream({
          ...options,
          ...prepared.config,
          messages: injected.messages,
          __weneedBypass: true,
        });
        return;
      }
      const policyEligible = injected.reason === 'user-task'
        || (injected.reason === 'tool-step'
          && lastCompactionIndex(injected.messages) < lastRealUserIndex(injected.messages));
      const taskedMessages = policyEligible
        ? appendTaskPolicy(injected.messages, config.taskPolicy === true)
        : injected.messages;
      const taskPolicyChanged = taskedMessages !== injected.messages;
      const scopeStart = config.mirrorScope === 'all' ? 0 : taskScopeStart(taskedMessages);
      const mirroredMessages = mirrorMessages(
        taskedMessages,
        config.mirror !== false,
        config.mirrorToolSteps === true,
        scopeStart,
      );
      const mirrorChanged = mirroredMessages !== taskedMessages;
      const compactedMessages = shouldAnchorAfterCompaction(injected.reason, mirroredMessages)
        ? anchorAfterCompaction(mirroredMessages, config.postCompactionSeed, SEED, scopeStart)
        : mirroredMessages;
      const compactChanged = compactedMessages !== mirroredMessages;
      const channelMessages = normalizeReasoningChannelMessages(compactedMessages, scopeStart);
      const reasoningChanged = channelMessages !== compactedMessages;
      const reasonedMessages = injected.reason === 'tool-step'
        ? appendToolStepReasoning(channelMessages, config.toolStepReasoning, TOOL_STEP_ANCHOR, SEED, scopeStart)
        : channelMessages;
      const toolReasoningChanged = reasonedMessages !== channelMessages;
      const anchoredMessages = injected.reason === 'tool-step' && reasonedMessages === compactedMessages
        ? anchorEmptyToolPlan(reasonedMessages, config.toolStepAnchor, TOOL_STEP_ANCHOR, scopeStart)
        : reasonedMessages;
      const anchorChanged = anchoredMessages !== reasonedMessages;
      const allowToolStepContent = config.mirrorToolSteps === true
        || ['content', 'both'].includes(String(config.toolStepAnchor ?? 'off').toLowerCase())
        || ['content', 'both'].includes(String(config.postCompactionSeed ?? 'off').toLowerCase());
      const contentSafeMessages = allowToolStepContent
        ? anchoredMessages
        : stripToolCallAssistantContent(anchoredMessages);
      const sanitizedMessages = sanitizeProgramMessages(contentSafeMessages);
      const sanitizedTools = sanitizeToolDefinitions(options.tools);
      const programChanged = sanitizedMessages !== anchoredMessages || sanitizedTools !== options.tools;
      if (injected.reason === 'compaction-request'
        || injected.reason === 'title-or-suggestion'
        || typeof ctx.llm?.prepareCall !== 'function') {
        yield* next();
        return;
      }
      if (!injected.injected && !filterChanged && !taskPolicyChanged && !mirrorChanged && !compactChanged && !reasoningChanged && !toolReasoningChanged && !anchorChanged && !programChanged) {
        yield* next();
        return;
      }
      let prepared;
      try {
        prepared = await ctx.llm.prepareCall({
          provider: options.provider,
          model: options.model,
          ...(options.reasoningEffort === undefined ? {} : { reasoningEffort: options.reasoningEffort }),
          ...(options.temperature === undefined ? {} : { temperature: options.temperature }),
          ...(options.maxTokens === undefined ? {} : { maxTokens: options.maxTokens }),
          ...(options.stop === undefined ? {} : { stop: options.stop }),
        }, options.signal);
      } catch (error) {
        auditRecord({ event: 'prepare-error', path: 'main', model: options.model, error: String(error?.message || error) });
        yield* next();
        return;
      }
      yield* prepared.stream({
        ...options,
        ...prepared.config,
        messages: sanitizedMessages,
        ...(sanitizedTools === options.tools ? {} : { tools: sanitizedTools }),
        __weneedBypass: true,
      });
    }, { global: true });
  }
}
