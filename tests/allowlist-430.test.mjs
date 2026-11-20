// 4.3.0 fundamental robustness: task entry is ALLOWLIST-driven. Only `user`,
// `goal`, `schedule`, `tool-goal` are tasks; EVERY other typed source.kind is
// context by default — including kinds a future DSH update has not invented
// yet. The seed/reasoning/content therefore stay adjacent to the REAL task
// without maintaining a deny-list. Pure-function tests via injectSeed.
import assert from 'node:assert/strict';
import { injectSeed } from '../index.js';

const opts = { model: 'deepseek-v4.1-flash', provider: 'opendesign' };
const sys = { role: 'system', content: 'You are a coding agent.' };
const user = (t) => ({ role: 'user', content: t, source: { kind: 'user' } });
const ctx = (kind, t) => ({ role: 'user', content: t, source: { kind } });
const plain = (t) => ({ role: 'assistant', content: [{ type: 'text', text: t }] });
const seedIdxOf = (res) => res.messages.findIndex((m) => m.source?.kind === 'model');

// 1. Arbitrary novel typed kinds (never seen before) are context, not the anchor.
for (const kind of [
  'auto-progress-v2', 'tool-batch-nudge', 'brand-new-reminder-2027',
  'heartbeat-context', 'planner-note', 'some-future-kind',
]) {
  const msgs = [sys, user('Need fix the beak color.'), plain('We need handle it.'), ctx(kind, 'a generated notice')];
  const res = injectSeed(msgs, opts, {});
  assert.equal(res.injected, true, `${kind}: real task still injects`);
  assert.equal(res.taskIndex, 1, `${kind}: real user task stays the anchor`);
  const si = seedIdxOf(res);
  assert.ok(si >= 0 && res.messages[si + 1].content === 'Need fix the beak color.',
    `${kind}: seed immediately precedes the real task`);
}

// 2. CRITICAL: a novel typed kind whose TEXT looks like a real task is STILL
// context. Under the old deny-list an unknown kind fell through to the text
// sniff and could steal the anchor; the allowlist makes kind authoritative.
{
  const msgs = [sys, user('Need fix the beak color.'), plain('We need handle it.'), ctx('future-task-kind', 'Need refactor the whole module now.')];
  const res = injectSeed(msgs, opts, {});
  assert.equal(res.taskIndex, 1, 'task-like text in a novel typed kind must not become the anchor');
  const si = seedIdxOf(res);
  assert.equal(res.messages[si + 1].content, 'Need fix the beak color.', 'seed stays on the real user task');
}

// 3. A novel typed kind ALONE (no real task) -> no injection (safer failure
// mode: detectable "no-user-task", not silent anchor drift).
{
  const res = injectSeed([sys, ctx('future-task-kind', 'Need refactor the whole module now.')], opts, {});
  assert.equal(res.injected, false, 'novel kind alone is not a task');
  assert.equal(res.reason, 'no-user-task', 'novel kind alone -> no-user-task');
}

// 4. The allowlist task kinds all remain tasks (goal-only injection preserved).
for (const kind of ['user', 'goal', 'schedule', 'tool-goal']) {
  const res = injectSeed([sys, ctx(kind, 'Need achieve the deliverable.')], opts, {});
  assert.equal(res.injected, true, `${kind} must inject`);
  assert.equal(res.taskIndex, 1, `${kind} must be the task`);
}

// 5. Untyped legacy/delegated requests still use the text fallback.
assert.equal(injectSeed([sys, { role: 'user', content: 'a real request' }], opts, {}).injected, true,
  'untyped real request -> task via text fallback');
assert.equal(injectSeed([sys, { role: 'user', content: 'Current runtime context. cwd=/x' }], opts, {}).injected, false,
  'untyped context text -> context via text fallback');

// 6. On a tool step, a novel context kind is reordered BEFORE the seed so the
// seed stays adjacent to the real task (fundamental adjacency, any future kind).
{
  const toolTurn = { role: 'assistant', content: [{ type: 'tool-call', id: 'c1', name: 'read', arguments: {} }] };
  const toolRes = { role: 'tool', toolCallId: 'c1', content: 'ok' };
  const msgs = [sys, user('Need inspect files.'), toolTurn, toolRes, ctx('auto-batch-nudge-2027', 'Send a progress update now.')];
  const res = injectSeed(msgs, opts, {}, undefined, false, 'we-need', true);
  assert.equal(res.reason, 'tool-step', 'still a tool step after the novel context');
  const si = seedIdxOf(res);
  assert.ok(si >= 0, 'seed inserted on tool step');
  assert.equal(res.messages[si + 1].content, 'Need inspect files.', 'real task immediately after the seed');
  const ni = res.messages.findIndex((m) => m.source?.kind === 'auto-batch-nudge-2027');
  assert.ok(ni >= 0 && ni < si, 'novel context reordered before the seed, not the anchor');
}

console.log('PASS 4.3.0 allowlist robustness: novel typed kinds default to context, seed stays adjacent to the real task');