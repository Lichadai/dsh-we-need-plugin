// 2.1.0 feature regression: B2 purpose-authoritative compaction + B1 goal/context
// kind matrix. Pure-function tests via injectSeed (no host ctx needed).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { injectSeed } from '../index.js';

const SEED = readFileSync(new URL('../seed.txt', import.meta.url), 'utf8').trim();
const MODEL = { name: 'DeepSeek-V4.1-Flash' };
const OPT = { provider: 'opendesign', model: 'deepseek-v4.1-flash', maxTokens: 300000 };
const text = (v) => [{ type: 'text', text: v }];
const user = (v, kind) => ({ role: 'user', content: text(v), ...(kind ? { source: { kind } } : {}) });
const sys = (v) => ({ role: 'system', content: text(v) });
const REGISTER_HEAD = 'Style requirement: write the checkpoint';

// B2: purpose:'compaction' is authoritative even when the text does not match
// the legacy sniff. Before 2.1.0 this fell through to 'auxiliary' (register lost).
const purposeCompaction = injectSeed([sys('s'), user('please condense prior turns')], { ...OPT, purpose: 'compaction' }, MODEL);
assert.equal(purposeCompaction.reason, 'compaction-request');
assert.ok(purposeCompaction.messages.some(m => m.role === 'user' && m.content.some(b => b.text && b.text.includes(REGISTER_HEAD))), 'register must be appended on purpose-compaction');

// B2 fallback: legacy text sniff still works without purpose.
const textCompaction = injectSeed([sys('You are acting as a compaction engine. Output only the checkpoint text.')], OPT, MODEL);
assert.equal(textCompaction.reason, 'compaction-request');

// B1: goal-only session anchors the seed (goal is a task, not context).
const goalOnly = injectSeed([sys('s'), user('<goal_round>optimize stability</goal_round>', 'goal')], OPT, MODEL);
assert.equal(goalOnly.injected, true);
assert.equal(goalOnly.reason, 'user-task');

// B1: a generated context kind alone is not a task.
for (const kind of ['runtime-context', 'team-message', 'skill-catalog', 'time-context', 'user-approval', 'subagent-report', 'compact-checkpoint']) {
  const r = injectSeed([sys('s'), user('generated context block', kind)], OPT, MODEL);
  assert.equal(r.injected, false, `${kind} must be context`);
  assert.equal(r.reason, 'no-user-task', `${kind} -> no-user-task`);
}

// B1: context kind + goal task -> seed sits before the goal, context before seed.
const mixed = injectSeed([sys('s'), user('team msg', 'team-message'), user('do thing', 'goal')], OPT, MODEL);
assert.equal(mixed.injected, true);
const si = mixed.messages.findIndex(m => m.role === 'assistant');
const gi = mixed.messages.findIndex(m => m.source?.kind === 'goal');
assert.ok(si >= 0 && gi > si, 'seed before goal');

// B1: user kind is always a task; unknown future kind falls back to text.
assert.equal(injectSeed([sys('s'), user('real request', 'user')], OPT, MODEL).injected, true);
assert.equal(injectSeed([sys('s'), user('a real request', 'future-task-kind')], OPT, MODEL).injected, true);

// B1: tool-goal / schedule are task kinds (fall through), not context.
assert.equal(injectSeed([sys('s'), user('scheduled work', 'schedule')], OPT, MODEL).injected, true);
assert.equal(injectSeed([sys('s'), user('tool goal work', 'tool-goal')], OPT, MODEL).injected, true);

console.log('PASS 2.1.0 features: purpose-authoritative compaction + goal/context kind matrix');