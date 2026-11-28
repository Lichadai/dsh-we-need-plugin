// toolStepReseed: the seed is synthetic and DSH does not persist it in history,
// so stripping it on tool steps leaves no WeNeed anchor (model re-states the
// task). Opt-in reseed keeps the seed adjacent to the task on every tool step.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  injectSeed, fillAssistantContent, appendToolStepReasoning, wireMessage, reasoningTextOf,
  toolStepOrientationBlock, DEFAULT_TARGET_RULES, TOOL_STEP_ANCHOR,
  ORIENTATION_LABEL, ORIENTATION_END, ORIENTATION_CONTINUE, ORIENTATION_TASKS_HEAD, ORIENTATION_PREVIOUS_HEAD,
} from '../index.js';

const SEED = readFileSync(new URL('../seed.txt', import.meta.url), 'utf8').trim();
const MODEL = { name: 'DeepSeek-V4.1-Flash' };
const OPTIONS = { provider: 'opendesign', model: 'deepseek-v4.1-flash', maxTokens: 300000 };
const text = (v) => [{ type: 'text', text: v }];
const user = (v) => ({ role: 'user', content: text(v) });
const system = (v) => ({ role: 'system', content: text(v) });
const assistantTool = () => ({ role: 'assistant', content: [{ type: 'tool-call', id: 'call-1', name: 'read', arguments: '{}' }] });
const tool = () => ({ role: 'tool', content: text('result'), toolCallId: 'call-1' });
const flat = (m) => (m.content ?? []).map((b) => b.text || '').join('');
const isSeedMsg = (m) => m.role === 'assistant' && m.content?.find((b) => b.type === 'text')?.text === SEED;
const seedLen = (m) => ({
  content: m.content.find((b) => b.type === 'text')?.text?.length,
  reasoning: m.content.find((b) => b.type === 'reasoning')?.text?.length,
});
const reseed = (msgs, on = true, model = MODEL) =>
  injectSeed(msgs, OPTIONS, model, DEFAULT_TARGET_RULES, false, 'we-need', on);

const input = [system('system prompt'), user('task'), user('Current runtime context. ws D:\\w'), assistantTool(), tool()];

// default off: existing behavior preserved (no seed on tool step).
{
  const r = reseed(input, false);
  assert.equal(r.reason, 'tool-step');
  assert.equal(r.injected, false);
  assert.ok(!r.messages.some((m) => isSeedMsg(m)), 'no seed when off');
}

// on: seed re-injected adjacent to the task.
{
  const r = reseed(input, true);
  assert.equal(r.reason, 'tool-step');
  assert.equal(r.injected, true);
  const seedIdx = r.messages.findIndex((m) => isSeedMsg(m));
  const taskIdx = r.messages.findIndex((m) => m.role === 'user' && flat(m) === 'task');
  assert.ok(seedIdx >= 0, 'seed present');
  assert.equal(taskIdx, seedIdx + 1, 'seed adjacent to task');
  assert.deepEqual(seedLen(r.messages[seedIdx]), { content: SEED.length, reasoning: SEED.length });
  // tool pair preserved after the task.
  assert.equal(r.messages[r.messages.length - 1].role, 'tool');
  assert.ok(r.messages.some((m) => m.role === 'assistant' && m.content[0]?.type === 'tool-call'), 'tool-call kept');
}

// idempotent: re-running strips the old seed and re-injects exactly one.
{
  const once = reseed(input, true);
  const twice = reseed(once.messages, true);
  const seeds = twice.messages.filter((m) => isSeedMsg(m));
  assert.equal(seeds.length, 1, 'no seed accumulation');
}

// non-target model: no reseed even when flag on.
{
  const r = injectSeed(input, { ...OPTIONS, model: 'gpt-4o' }, { name: 'GPT-4o' }, DEFAULT_TARGET_RULES, false, 'we-need', true);
  assert.equal(r.injected, false);
  assert.ok(!r.messages.some((m) => isSeedMsg(m)), 'no seed for non-target');
}

// assistant placement: no new message; the orientation block is embedded in
// the latest tool-call assistant's existing content field. The tool pair,
// task, and message count stay unchanged.
{
  const inputWithReasoning = [
    system('system prompt'),
    user('task'),
    user('Current runtime context. ws D:\\w'),
    {
      role: 'assistant',
      content: [
        { type: 'reasoning', text: 'Need inspect the files.' },
        { type: 'tool-call', id: 'call-1', name: 'read', arguments: '{}' },
      ],
      source: { kind: 'model', replayState: { response: { api: 'openai-completions' }, blocks: [{ type: 'reasoning', thinkingSignature: 'reasoning_content' }, { type: 'tool-call' }] } },
    },
    tool(),
  ];
  const flags = { toolStepSeedPlacement: 'assistant', orientation: { mode: 'full' } };
  const r = injectSeed(inputWithReasoning, OPTIONS, MODEL, DEFAULT_TARGET_RULES, false, 'we-need', true, flags);
  assert.equal(r.reason, 'tool-step');
  assert.equal(r.injected, false, 'assistant placement does not add a separate seed message');
  assert.equal(r.messages.length, inputWithReasoning.length, 'tool-step message count unchanged');
  assert.equal(r.messages.filter((m) => isSeedMsg(m)).length, 0, 'no synthetic seed message');

  const orientation = {
    mode: 'full',
    placement: 'assistant',
    usage: { pressureTokens: 48200, contextWindow: 262144 },
    todos: [{ content: 'Need read a.txt', status: 'in_progress' }],
  };
  const withReasoning = appendToolStepReasoning(r.messages, 'anchor-seed', TOOL_STEP_ANCHOR, SEED, 0);
  const out = fillAssistantContent(withReasoning, 'seed-continue-reasoning', 0, orientation);
  const assistantIdx = out.findIndex((m) => m.role === 'assistant' && m.content?.some((b) => b.type === 'tool-call'));
  assert.ok(assistantIdx >= 0, 'tool-call assistant kept');
  assert.equal(out.length, inputWithReasoning.length, 'no message added by field placement');
  const content = out[assistantIdx].content
    .filter((b) => b.type === 'text')
    .map((b) => b.text || '')
    .join('');
  const reasoning = reasoningTextOf(out[assistantIdx]).trim();
  assert.ok(content.includes(ORIENTATION_LABEL), 'orientation label moved into existing content');
  assert.ok(content.includes(SEED), 'seed moved into existing content');
  assert.ok(content.includes(ORIENTATION_TASKS_HEAD), 'todo section moved into existing content');
  assert.ok(content.includes(ORIENTATION_END), 'example end boundary moved into existing content');
  assert.ok(content.includes(ORIENTATION_CONTINUE), 'continue line moved into existing content');
  assert.equal(content.includes(ORIENTATION_PREVIOUS_HEAD), false, 'embedded block does not duplicate previous reasoning');
  assert.ok(reasoning.startsWith('Need inspect the files.'), 'own reasoning remains first');
  assert.ok(reasoning.includes(SEED), 'seed anchor remains in reasoning_content');
  assert.equal(out[assistantIdx].content.some((b) => b.type === 'tool-call'), true, 'tool_calls kept on the same assistant');
  assert.equal(out[out.length - 1].role, 'tool', 'tool result remains the last message');
  const wire = wireMessage(out[assistantIdx], false, false);
  assert.deepEqual(Object.keys(wire), ['role', 'content', 'reasoning_content', 'tool_calls'], 'DSH field order preserved');
  assert.equal(typeof wire.content, 'string', 'wire content is a string');
  assert.ok(wire.content.includes(ORIENTATION_LABEL), 'wire content carries the moved orientation');
  assert.equal(typeof wire.reasoning_content, 'string', 'wire reasoning_content is a string');
  assert.ok(wire.reasoning_content.includes(SEED), 'wire reasoning_content carries seed anchor');
  assert.equal(wire.tool_calls[0].id, 'call-1', 'tool call id unchanged');
}

console.log('toolstep-reseed: all assertions passed');