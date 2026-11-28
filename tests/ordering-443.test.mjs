import assert from 'node:assert/strict';
import {
  injectSeed,
  orderContextsBeforeAllTasks,
  taskScopeStart,
  SEED,
} from '../index.js';

const user = (text, kind = 'user') => ({
  role: 'user',
  content: [{ type: 'text', text }],
  source: { kind },
});
const context = (text) => user(text, 'runtime-context');
const assistant = (text) => ({
  role: 'assistant',
  content: [{ type: 'reasoning', text }, { type: 'tool-call', id: 'c1', name: 'read', arguments: {} }],
  source: { kind: 'model' },
});
const toolResult = (text = 'ok') => ({ role: 'tool', toolCallId: 'c1', content: text });
const roles = (messages) => messages.map((m) => `${m.role}:${m.role === 'user' ? (m.content?.[0]?.text ?? '') : ''}`);

// 1. Every task group gets the same context-before-task order; contexts after a
// task belong to that task, not to the next one.
{
  const msgs = [
    user('Need task one.'),
    context('Need context one a.'),
    context('Need context one b.'),
    assistant('Need work one.'),
    toolResult(),
    user('Need task two.'),
    context('Need context two.'),
  ];
  const out = orderContextsBeforeAllTasks(msgs);
  assert.deepEqual(roles(out), [
    'user:Need context one a.',
    'user:Need context one b.',
    'user:Need task one.',
    'assistant:',
    'tool:',
    'user:Need context two.',
    'user:Need task two.',
  ], 'contexts move in front of the task they followed');
}

// 2. The prefix of a tool-step request and the prefix of a later continuation
// must be byte-identical for the same history — this is the cache contract.
{
  const history = [
    user('Need task one.'),
    context('Need context one.'),
    assistant('Need work one.'),
    toolResult(),
  ];
  const toolStep = [...history, assistant('Need work two.'), toolResult()];
  const continuation = [...history, user('Need task two.')];
  const a = orderContextsBeforeAllTasks(toolStep);
  const b = orderContextsBeforeAllTasks(continuation);
  assert.deepEqual(a.slice(0, history.length), b.slice(0, history.length), 'shared history must keep the same order');
  assert.equal(a[0].content[0].text, 'Need context one.', 'context one stays first');
  assert.equal(a[1].content[0].text, 'Need task one.', 'task one stays after its context');
}

// 3. New-user-task injection keeps the canonical prefix and still puts exactly
// one synthetic seed immediately before the real task.
{
  const msgs = [
    user('Need task one.'),
    context('Need context one.'),
    assistant('Need work one.'),
    toolResult(),
    user('Need task two.'),
    context('Need context two.'),
  ];
  const out = injectSeed(msgs, { provider: 'opendesign', model: 'deepseek-v4.1-flash', maxTokens: 300000 }, { name: 'DeepSeek-V4.1-Flash' });
  assert.equal(out.reason, 'user-task');
  assert.equal(out.injected, true);
  const seedIndex = out.messages.findIndex((m) => String(m.id ?? '').startsWith('weneed-seed-'));
  const taskIndex = out.messages.findIndex((m) => m.role === 'user' && m.source?.kind === 'user' && m.content[0].text === 'Need task two.');
  assert.ok(seedIndex >= 0, 'one seed exists');
  assert.equal(seedIndex + 1, taskIndex, 'seed is immediately before the real task');
  const firstContext = out.messages.findIndex((m) => m.role === 'user' && m.source?.kind === 'runtime-context');
  const firstTask = out.messages.findIndex((m) => m.role === 'user' && m.source?.kind === 'user');
  assert.ok(firstContext < firstTask, 'context one precedes task one');
  assert.ok(out.messages[seedIndex].content.some((b) => b.type === 'text' && b.text.includes(SEED)), 'seed carries the seed text');
  assert.ok(out.messages[seedIndex].content.some((b) => b.type === 'reasoning' && b.text.includes(SEED)), 'seed reasoning mirrors content');
}

// 4. No task -> no reorder, same reference.
{
  const msgs = [context('Need context.'), assistant('Need work.')];
  assert.equal(orderContextsBeforeAllTasks(msgs), msgs, 'no task leaves the list untouched');
}

// 5. Compaction segment is not reordered across the checkpoint.
{
  const compaction = { role: 'user', content: '<compacted-summary>checkpoint</compacted-summary>', source: { kind: 'compact-checkpoint' } };
  const msgs = [user('Need task one.'), context('Need context one.'), compaction, assistant('Need work.')];
  const out = orderContextsBeforeAllTasks(msgs);
  assert.equal(out, msgs, 'a segment containing a compaction checkpoint stays as-is');
}

console.log('ordering-443: all assertions passed');