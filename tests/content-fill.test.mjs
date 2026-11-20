import assert from 'node:assert/strict';
import {
  fillAssistantContent, CONTINUE_WORK, SEED,
  COMPACTION_REGISTER, COMPACTION_REGISTER_HEAD,
  wireMessage, reasoningTextOf,
} from '../index.js';

const textOf = (m) => Array.isArray(m.content)
  ? m.content.filter((b) => b?.type === 'text' || b?.type === undefined).map((b) => b.text || '').join('')
  : String(m.content || '');

// DSH-shaped assistant tool-call turn: empty visible text, native reasoning block,
// replayState aligned to content blocks.
function toolTurn(reasoning, id = 'c1') {
  const content = [];
  const blocks = [];
  if (reasoning) {
    content.push({ type: 'reasoning', text: reasoning });
    blocks.push({ type: 'reasoning', thinkingSignature: 'reasoning_content' });
  }
  content.push({ type: 'tool-call', id, name: 'read', arguments: {} });
  blocks.push({ type: 'tool-call' });
  return {
    role: 'assistant',
    content,
    source: { kind: 'model', replayState: { response: { api: 'openai-completions' }, blocks } },
  };
}
function plainTurn(reasoning) {
  return {
    role: 'assistant',
    content: [{ type: 'reasoning', text: reasoning }],
    source: { kind: 'model', replayState: { response: { api: 'openai-completions' }, blocks: [{ type: 'reasoning', thinkingSignature: 'reasoning_content' }] } },
  };
}
const user = (t) => ({ role: 'user', content: t, source: { kind: 'user' } });
const toolResult = (id, t) => ({ role: 'tool', toolCallId: id, content: t });

// 1. off is a no-op
{
  const msgs = [user('Need do work.'), toolTurn('Need inspect.'), toolResult('c1', 'ok')];
  assert.equal(fillAssistantContent(msgs, 'off'), msgs, 'off must be a no-op');
  assert.equal(fillAssistantContent(msgs, undefined), msgs, 'default off must be a no-op');
}

// 2. latest empty tool-call turn with reasoning -> seed + continue + reasoning
{
  const msgs = [user('Need do work.'), toolTurn('Need inspect the file.'), toolResult('c1', 'ok')];
  const out = fillAssistantContent(msgs, 'seed-continue-reasoning');
  const filled = out[1];
  const text = textOf(filled);
  assert.ok(text.startsWith(SEED), 'latest tool turn content must lead with the seed');
  assert.ok(text.includes(CONTINUE_WORK), 'latest tool turn content must carry continue-work');
  assert.ok(text.includes('Need inspect the file.'), 'latest tool turn content must keep its own reasoning');
  assert.equal(reasoningTextOf(filled).trim(), 'Need inspect the file.', 'reasoning channel must be unchanged');
  // replayState stays aligned to content blocks
  assert.equal(filled.source.replayState.blocks.length, filled.content.length, 'replay blocks must align with content');
}

// 3. latest empty tool-call turn without reasoning -> seed + continue (no trailing empty)
{
  const msgs = [user('Need do work.'), toolTurn(''), toolResult('c1', 'ok')];
  const out = fillAssistantContent(msgs, 'seed-continue-reasoning');
  const text = textOf(out[1]);
  assert.ok(text.includes(SEED) && text.includes(CONTINUE_WORK), 'empty-reasoning latest turn still gets seed+continue');
}

// 4. older empty assistant turns mirror their own reasoning (no seed repetition)
{
  const msgs = [
    user('Need do work.'),
    toolTurn('Need older step.', 'c0'), toolResult('c0', 'ok0'),
    toolTurn('Need latest step.', 'c1'), toolResult('c1', 'ok1'),
  ];
  const out = fillAssistantContent(msgs, 'seed-continue-reasoning');
  const older = textOf(out[1]);
  const latest = textOf(out[3]);
  assert.equal(older, 'Need older step.', 'older empty turn mirrors reasoning only');
  assert.equal(older.includes(SEED), false, 'older turn must NOT repeat the seed');
  assert.ok(latest.startsWith(SEED), 'latest turn leads with seed');
}

// 5. existing visible speech is never overwritten
{
  const spoken = { role: 'assistant', content: [{ type: 'text', text: 'We need keep this speech.' }, { type: 'tool-call', id: 'c1', name: 'read', arguments: {} }] };
  const msgs = [user('Need do work.'), spoken, toolResult('c1', 'ok')];
  const out = fillAssistantContent(msgs, 'seed-continue-reasoning');
  assert.equal(textOf(out[1]), 'We need keep this speech.', 'non-empty content must be preserved');
}

// 6. general: fills on a user-task request (no trailing tool result needed)
{
  const msgs = [user('Need first task.'), plainTurn('Need plan the work.')];
  const out = fillAssistantContent(msgs, 'seed-continue-reasoning');
  // plainTurn is the latest assistant but has no tool_calls -> mirrored reasoning only
  assert.equal(textOf(out[1]), 'Need plan the work.', 'user-task assistant reasoning mirrored into content');
}

// 7. idempotent: second pass does not double-fill
{
  const msgs = [user('Need do work.'), toolTurn('Need inspect.'), toolResult('c1', 'ok')];
  const once = fillAssistantContent(msgs, 'seed-continue-reasoning');
  const twice = fillAssistantContent(once, 'seed-continue-reasoning');
  assert.equal(twice, once, 'second pass must be a no-op (content already non-empty)');
  assert.equal(textOf(twice[1]).split(SEED).length - 1, 1, 'seed must appear exactly once');
}

// 8. wireMessage sends the filled content for a tool-call turn (mirror off)
{
  const msgs = [user('Need do work.'), toolTurn('Need inspect.'), toolResult('c1', 'ok')];
  const out = fillAssistantContent(msgs, 'seed-continue-reasoning');
  const wire = wireMessage(out[1], false, false);
  assert.ok(wire.content.includes(SEED), 'wire content must carry the fill');
  assert.ok(Array.isArray(wire.tool_calls) && wire.tool_calls.length === 1, 'tool_calls preserved');
  assert.equal(wire.reasoning_content, 'Need inspect.', 'wire reasoning_content preserved');
}

// 9. compaction register simplified: no second-to-last rule, still WeNeed voice
{
  assert.ok(COMPACTION_REGISTER.includes(COMPACTION_REGISTER_HEAD), 'compaction keeps WeNeed head');
  assert.equal(/上上次|second-to-last|immediately preceding assistant turn as the actual work/i.test(COMPACTION_REGISTER), false, '上上次 / second-to-last rule must be removed');
  assert.ok(/Need|Should|Must/.test(COMPACTION_REGISTER), 'compaction keeps Need/Should/Must register');
  assert.ok(COMPACTION_REGISTER.includes('path, command, error string'), 'compaction keeps fidelity requirement');
}

// 10. cross-boundary (4.3.1): interrupt/resume — the correction is a NEW task
// boundary (scopeStart after it). Prior-task history empty content BEFORE the
// boundary must still be续上 with its own reasoning, so the resume turn sees the
// prior WeNeed voice in content instead of empty history.
{
  const msgs = [
    user('Need first task.'),                    // 0 initial task
    toolTurn('Need fix the SVG colors.', 'c0'),  // 1 history tool turn, empty content
    toolResult('c0', 'ok0'),                     // 2
    plainTurn('We see the rendered image.'),     // 3 history plain turn, empty content
    user('Continue. Correction: beak orange.'),  // 4 NEW task boundary (resume)
  ];
  const out = fillAssistantContent(msgs, 'seed-continue-reasoning', 5); // scopeStart = 4+1
  assert.equal(textOf(out[1]), 'Need fix the SVG colors.', 'history tool turn content mirrored across boundary');
  assert.equal(textOf(out[3]), 'We see the rendered image.', 'history plain turn content mirrored across boundary');
  assert.equal(textOf(out[1]).includes(SEED), false, 'history mirror must NOT inject the seed');
  assert.equal(reasoningTextOf(out[1]).trim(), 'Need fix the SVG colors.', 'history reasoning channel unchanged');
  assert.equal(out[1].source.replayState.blocks.length, out[1].content.length, 'history replay blocks stay aligned');
}

// 11. cross-boundary with a current-scope tool turn: history mirrors reasoning,
// the CURRENT task's latest tool turn still gets seed+continue+reasoning.
{
  const msgs = [
    user('Need first task.'),                    // 0
    toolTurn('Need older history step.', 'c0'),  // 1 history (index < scopeStart)
    toolResult('c0', 'ok0'),                     // 2
    user('Continue. Correction.'),               // 3 boundary
    toolTurn('Need current step.', 'c1'),        // 4 current-scope latest tool turn
    toolResult('c1', 'ok1'),                     // 5
  ];
  const out = fillAssistantContent(msgs, 'seed-continue-reasoning', 4); // scopeStart = 3+1
  assert.equal(textOf(out[1]), 'Need older history step.', 'history before boundary mirrors own reasoning');
  assert.equal(textOf(out[1]).includes(SEED), false, 'history must not repeat seed');
  assert.ok(textOf(out[4]).startsWith(SEED), 'current-scope latest tool turn leads with seed');
  assert.ok(textOf(out[4]).includes(CONTINUE_WORK), 'current latest carries continue-work');
  assert.ok(textOf(out[4]).includes('Need current step.'), 'current latest keeps its own reasoning');
}

console.log('content-fill: all assertions passed');