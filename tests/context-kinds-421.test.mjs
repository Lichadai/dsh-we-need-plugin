import assert from 'node:assert/strict';
import { injectSeed } from '../index.js';

const opts = { model: 'deepseek-v4.1-flash', provider: 'opendesign' };
const sys = { role: 'system', content: 'You are a coding agent.' };
const user = (t) => ({ role: 'user', content: t, source: { kind: 'user' } });
const ctx = (kind, t) => ({ role: 'user', content: t, source: { kind } });
const plain = (t) => ({ role: 'assistant', content: [{ type: 'text', text: t }] });
const NUDGE = 'You have made a run of tool calls without reporting progress to the user. Send one progress update now with the progress_update tool.';

// 1. progress-updates-nudge must NOT become the task anchor
{
  const msgs = [sys, user('Need fix the beak color.'), plain('We need handle it.'), ctx('progress-updates-nudge', NUDGE)];
  const res = injectSeed(msgs, opts, {});
  assert.equal(res.taskIndex, 1, 'real user task stays the anchor; nudge is context');
  assert.notEqual(res.taskIndex, 3, 'nudge must not be treated as the task');
}

// 2. other new DSH context kinds are context, not task
for (const kind of ['team-board-notice', 'skill-invocation', 'dsh-session-title-llm']) {
  const msgs = [sys, user('Need do the work.'), plain('We need proceed.'), ctx(kind, 'some notice text')];
  const res = injectSeed(msgs, opts, {});
  assert.equal(res.taskIndex, 1, `${kind} must be context, real task stays anchor`);
}

// 3. nudge arriving on a tool step must not steal the anchor
{
  const toolTurn = { role: 'assistant', content: [{ type: 'tool-call', id: 'c1', name: 'read', arguments: {} }] };
  const toolRes = { role: 'tool', toolCallId: 'c1', content: 'ok' };
  const msgs = [sys, user('Need inspect files.'), toolTurn, toolRes, ctx('progress-updates-nudge', NUDGE)];
  const res = injectSeed(msgs, opts, {}, undefined, false, 'we-need', true);
  assert.equal(res.reason, 'tool-step', 'still a tool step after the nudge context');
  const seedIdx = res.messages.findIndex((m) => m.source?.kind === 'model');
  assert.ok(seedIdx >= 0, 'seed inserted on tool step');
  assert.equal(res.messages[seedIdx + 1].content, 'Need inspect files.', 'real user task immediately after the seed');
  const nudgeIdx = res.messages.findIndex((m) => m.source?.kind === 'progress-updates-nudge');
  assert.ok(nudgeIdx >= 0 && nudgeIdx < seedIdx, 'nudge reordered before seed as context, not the task anchor');
}

// 4. goal / tool-goal must STILL be treated as tasks (goal-only injection, §70)
for (const kind of ['goal', 'tool-goal']) {
  const msgs = [sys, ctx(kind, 'Need achieve the goal deliverable.')];
  const res = injectSeed(msgs, opts, {});
  assert.equal(res.taskIndex, 1, `${kind} must remain a task (goal-only injection)`);
  assert.equal(res.injected, true, `${kind} goal-only must inject seed`);
}

// 5. repeat-tool-reminder (the older consecutive-tool reminder) stays context
{
  const msgs = [sys, user('Need work.'), plain('We need continue.'), ctx('repeat-tool-reminder', 'Repeated tool call reminder.')];
  const res = injectSeed(msgs, opts, {});
  assert.equal(res.taskIndex, 1, 'repeat-tool-reminder stays context');
}

console.log('context-kinds-421: all assertions passed');