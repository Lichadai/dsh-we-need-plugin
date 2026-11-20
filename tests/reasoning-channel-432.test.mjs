// 4.3.2: reasoning_content channel normalization crosses the task boundary.
// On interrupt/resume the pre-interrupt history falls before the new task
// boundary; its reasoning signature must still be normalized to reasoning_content
// so pi-ai emits reasoning_content (the gateway reads only that field) and the
// model OWNS its prior thinking instead of re-litigating it as external speech.
import assert from 'node:assert/strict';
import { normalizeReasoningChannelMessages, reasoningTextOf, wireMessage, taskScopeStart } from '../index.js';

const user = (t) => ({ role: 'user', content: t, source: { kind: 'user' } });
const toolResult = (id, t) => ({ role: 'tool', toolCallId: id, content: t });
// History tool turn whose reasoning block carries the RAW response signature
// 'reasoning' (what DSH history actually looks like before normalization).
function histTurn(reasoning, id = 'c0') {
  return {
    role: 'assistant',
    content: [{ type: 'reasoning', text: reasoning }, { type: 'tool-call', id, name: 'read', arguments: {} }],
    source: { kind: 'model', replayState: { response: { api: 'openai-completions' }, blocks: [{ type: 'reasoning', thinkingSignature: 'reasoning' }, { type: 'tool-call' }] } },
  };
}
const sigOf = (m) => {
  const i = m.content.findIndex((b) => b?.type === 'reasoning');
  return m.source?.replayState?.blocks?.[i]?.thinkingSignature;
};

// 1. Cross-boundary: history BEFORE scopeStart still gets reasoning_content signature.
{
  const PLAN = 'We need fix SVG colors. Sky #87ceeb, beak #ffa500, body #f5f5f5, frame #1a1a1a.';
  const msgs = [user('Need first task.'), histTurn(PLAN), toolResult('c0', 'ok'), user('Continue. Correction: sky looks paler.')];
  const scopeStart = taskScopeStart(msgs);
  assert.ok(scopeStart > 1, 'history turn is before the new task boundary');
  assert.equal(sigOf(msgs[1]), 'reasoning', 'precondition: history signature is raw reasoning');
  const out = normalizeReasoningChannelMessages(msgs, scopeStart);
  assert.equal(sigOf(out[1]), 'reasoning_content', 'history reasoning signature normalized to reasoning_content across boundary');
  assert.equal(reasoningTextOf(out[1]), PLAN, 'reasoning TEXT must be unchanged');
  const wire = wireMessage(out[1], false, false);
  assert.equal(wire.reasoning_content, PLAN, 'wire emits reasoning_content for history (gateway reads it)');
  assert.ok(Array.isArray(wire.tool_calls) && wire.tool_calls.length === 1, 'tool_calls preserved');
}

// 2. Idempotent: a normalized history turn is left alone on the second pass.
{
  const msgs = [user('Need first task.'), histTurn('Need inspect.'), toolResult('c0', 'ok'), user('Continue.')];
  const scopeStart = taskScopeStart(msgs);
  const once = normalizeReasoningChannelMessages(msgs, scopeStart);
  const twice = normalizeReasoningChannelMessages(once, scopeStart);
  assert.equal(twice, once, 'second pass must be a no-op');
}

// 3. Multiple history turns before the boundary all normalized; current-scope too.
{
  const msgs = [
    user('Need first task.'),
    histTurn('Need step one.', 'c0'), toolResult('c0', 'ok0'),
    histTurn('Need step two.', 'c1'), toolResult('c1', 'ok1'),
    user('Continue. Correction.'),
    histTurn('Need current step.', 'c2'), toolResult('c2', 'ok2'),
  ];
  const scopeStart = taskScopeStart(msgs);
  const out = normalizeReasoningChannelMessages(msgs, scopeStart);
  for (const i of [1, 3, 6]) assert.equal(sigOf(out[i]), 'reasoning_content', `turn ${i} normalized (history and current)`);
  assert.equal(reasoningTextOf(out[1]), 'Need step one.', 'history text preserved');
  assert.equal(reasoningTextOf(out[6]), 'Need current step.', 'current text preserved');
}

// 4. Non-assistant and reasoning-free turns untouched.
{
  const msgs = [user('Need task.'), { role: 'assistant', content: [{ type: 'text', text: 'We need speak.' }] }, user('Continue.')];
  const out = normalizeReasoningChannelMessages(msgs, taskScopeStart(msgs));
  assert.equal(out[1].content[0].text, 'We need speak.', 'visible speech untouched');
  assert.equal(out[0], msgs[0], 'user untouched');
}

console.log('PASS 4.3.2 reasoning-channel cross-boundary normalization: history keeps reasoning_content identity, text unchanged, wire emits it');