import assert from 'node:assert/strict';
import {
  injectSeed,
  orderContextsBeforeAllTasks,
  orderContextsBeforeFirstResponse,
  SEED,
} from '../index.js';

const user = (text, kind = 'user') => ({
  role: 'user',
  content: [{ type: 'text', text }],
  source: { kind },
});
const context = (text) => user(text, 'time-context');
const runtime = (text) => user(text, 'runtime-context');
const task = (text) => user(text, 'user');
const assistant = (text, id = 'c1') => ({
  role: 'assistant',
  content: [
    { type: 'reasoning', text },
    { type: 'tool-call', id, name: 'read', arguments: {} },
  ],
  source: { kind: 'model' },
});
const toolResult = (text = 'ok', id = 'c1') => ({ role: 'tool', toolCallId: id, content: text });
const label = (m) => {
  if (m?.role === 'user') return `${m.source?.kind}:${m.content?.[0]?.text}`;
  if (m?.role === 'assistant') return `assistant:${m.content?.[0]?.text}`;
  if (m?.role === 'tool') return `tool:${m.content}`;
  return m?.role;
};
const labels = (messages) => messages.map(label);
const prefix = (before, after) => {
  const n = Math.max(before.length, after.length);
  for (let i = 0; i < n; i += 1) {
    if (label(before[i] ?? {}) !== label(after[i] ?? {})) return i;
  }
  return n;
};

const OPTIONS = { provider: 'opendesign', model: 'deepseek-v4.1-flash', maxTokens: 300000 };
const MODEL = { name: 'DeepSeek-V4.1-Flash' };

// 1. Initial context bundle still moves in front of the task; seed stays adjacent.
{
  const msgs = [task('Need T1.'), runtime('Runtime one.'), context('Time one.')];
  const ordered = orderContextsBeforeFirstResponse(msgs);
  assert.deepEqual(labels(ordered), [
    'runtime-context:Runtime one.',
    'time-context:Time one.',
    'user:Need T1.',
  ]);
  const out = injectSeed(msgs, OPTIONS, MODEL);
  assert.equal(out.reason, 'user-task');
  const seedIndex = out.messages.findIndex((m) => String(m.id ?? '').startsWith('weneed-seed-'));
  const taskIndex = out.messages.findIndex((m) => m.source?.kind === 'user');
  assert.equal(seedIndex + 1, taskIndex, 'seed must sit immediately before the real task');
}

// 2. Step-11 regression: a time-context appended after the latest tool result
// must stay there. The old 4.4.3 rule is kept only to prove it moves the task.
{
  const history = [
    task('Need T1.'),
    runtime('Runtime one.'),
    context('Time one.'),
    assistant('Need read A.', 'c1'),
    toolResult('A result', 'c1'),
    assistant('Need read B.', 'c2'),
    toolResult('B result', 'c2'),
  ];
  const historyFrozen = orderContextsBeforeFirstResponse(history);
  const withLate = [...historyFrozen, context('Elapsed 11m.')];

  const legacy = orderContextsBeforeAllTasks(withLate);
  const legacyLate = legacy.findIndex((m) => m.content?.[0]?.text === 'Elapsed 11m.');
  const legacyTask = legacy.findIndex((m) => m.source?.kind === 'user');
  assert.ok(
    legacyLate >= 0 && legacyLate < legacyTask,
    'legacy 4.4.3 hoists the late context in front of the old task',
  );

  const frozen = orderContextsBeforeFirstResponse(withLate);
  assert.deepEqual(labels(frozen), labels(historyFrozen).concat('time-context:Elapsed 11m.'));
  assert.equal(prefix(historyFrozen, frozen), historyFrozen.length, 'all prior messages keep their positions');

  const out = injectSeed(withLate, OPTIONS, MODEL);
  assert.equal(out.reason, 'tool-step', 'late context after tool result is still a tool step');
  assert.equal(out.injected, false, 'assistant placement adds no synthetic seed message');
  assert.deepEqual(labels(out.messages), labels(historyFrozen).concat('time-context:Elapsed 11m.'));
}

// 3. Resume after a late context: the old prefix is frozen; only the new task
// suffix is appended, and the seed remains immediately before the new task.
{
  const oldHistory = orderContextsBeforeFirstResponse([
    task('Need T1.'),
    runtime('Runtime one.'),
    assistant('Need read A.', 'c1'),
    toolResult('A result', 'c1'),
    context('Late context.'),
  ]);
  const resume = [
    ...oldHistory,
    task('Need T2.'),
    runtime('Runtime two.'),
  ];
  const ordered = orderContextsBeforeFirstResponse(resume);
  const out = injectSeed(resume, OPTIONS, MODEL);

  assert.equal(prefix(oldHistory, ordered), oldHistory.length, 'old history prefix is unchanged');
  assert.equal(out.reason, 'user-task');
  const seedIndex = out.messages.findIndex((m) => String(m.id ?? '').startsWith('weneed-seed-'));
  const taskIndex = out.messages.findIndex((m) => m.content?.[0]?.text === 'Need T2.');
  assert.equal(seedIndex + 1, taskIndex, 'seed is immediately before T2');
  assert.equal(taskIndex > seedIndex, true);
  const oldLate = out.messages.findIndex((m) => m.content?.[0]?.text === 'Late context.');
  assert.equal(oldLate, oldHistory.length - 1, 'the old late context did not move');
}

// 4. A context after the first response of a task is never hoisted, even when
// a newer task arrives later.
{
  const msgs = [
    task('Need T1.'),
    context('Initial time.'),
    assistant('Need read A.', 'c1'),
    toolResult('A result', 'c1'),
    runtime('Late runtime.'),
    task('Need T2.'),
  ];
  const out = orderContextsBeforeFirstResponse(msgs);
  assert.deepEqual(labels(out), [
    'time-context:Initial time.',
    'user:Need T1.',
    'assistant:Need read A.',
    'tool:A result',
    'runtime-context:Late runtime.',
    'user:Need T2.',
  ]);
}

// 5. Compaction checkpoint remains a hard boundary.
{
  const compaction = {
    role: 'user',
    content: '<compacted-summary>checkpoint</compacted-summary>',
    source: { kind: 'compact-checkpoint' },
  };
  const msgs = [task('Need T1.'), context('Late context.'), compaction, assistant('Need work.', 'c1')];
  const out = orderContextsBeforeFirstResponse(msgs);
  assert.equal(out, msgs, 'segment containing compaction must not be reordered');
}

// 6. The seed bytes and dual-channel shape are untouched by the ordering fix.
{
  const out = injectSeed([task('Need T1.')], OPTIONS, MODEL);
  const seed = out.messages.find((m) => String(m.id ?? '').startsWith('weneed-seed-'));
  const text = seed.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  const reasoning = seed.content.filter((b) => b.type === 'reasoning').map((b) => b.text).join('');
  assert.ok(text.includes(SEED), 'seed content carries the raw Kimi seed');
  assert.equal(text, reasoning, 'content and reasoning remain the full same block');
}

console.log('ordering-444: all assertions passed');