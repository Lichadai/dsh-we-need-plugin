// toolStepReseed: the seed is synthetic and DSH does not persist it in history,
// so stripping it on tool steps leaves no WeNeed anchor (model re-states the
// task). Opt-in reseed keeps the seed adjacent to the task on every tool step.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { injectSeed, DEFAULT_TARGET_RULES } from '../index.js';

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

console.log('toolstep-reseed: all assertions passed');