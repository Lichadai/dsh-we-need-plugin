// Regression: pi-ai replays the response's reasoning field name as the wire
// key. The gateway reads reasoning_content only, so a tool-call turn whose
// reasoning block carries thinkingSignature 'reasoning' (or 'reasoning_text')
// must be normalized to 'reasoning_content' before serialization. 1.0.9 forced
// this; the 2.0.0 replaySignatureFor refactor preserved the alias and lost the
// plan across tool steps. These tests pin the restored behavior.
import assert from 'node:assert/strict';
import { normalizeReasoningChannelMessages, reasoningTextOf } from '../index.js';

const PLAN = 'We need to read the config before editing it.';

function toolCallAssistant(signature, api = 'openai-completions') {
  return {
    role: 'assistant',
    content: [
      { type: 'reasoning', text: PLAN },
      { type: 'tool-call', id: 'call_1', name: 'read', arguments: '{"path":"a.txt"}' },
    ],
    source: {
      kind: 'model',
      provider: 'opendesign',
      model: 'deepseek-v4.1-flash',
      replayState: {
        response: { kind: 'pi-ai', version: 2, api, provider: 'opendesign', model: 'deepseek-v4.1-flash', stopReason: 'toolUse' },
        blocks: [
          { type: 'reasoning', ...(signature === undefined ? {} : { thinkingSignature: signature }) },
          { type: 'tool-call' },
        ],
      },
    },
  };
}

const sigOf = (m) => m.source.replayState.blocks[0].thinkingSignature;

// 'reasoning' alias -> reasoning_content (the actual regression).
{
  const out = normalizeReasoningChannelMessages([toolCallAssistant('reasoning')], 0);
  assert.equal(sigOf(out[0]), 'reasoning_content', 'reasoning alias must normalize');
  assert.equal(reasoningTextOf(out[0]), PLAN, 'plan text preserved');
  assert.ok(!('reasoning' in out[0]) && !('reasoning_content' in out[0]), 'no string aliases on the block message');
  assert.equal(out[0].content.length, 2, 'tool-call block kept');
  assert.equal(out[0].source.replayState.blocks.length, 2, 'replay stays index-aligned');
}

// 'reasoning_text' alias -> reasoning_content.
{
  const out = normalizeReasoningChannelMessages([toolCallAssistant('reasoning_text')], 0);
  assert.equal(sigOf(out[0]), 'reasoning_content', 'reasoning_text alias must normalize');
}

// already reasoning_content -> unchanged (idempotent, same reference).
{
  const msg = toolCallAssistant('reasoning_content');
  const out = normalizeReasoningChannelMessages([msg], 0);
  assert.equal(out[0], msg, 'clean reasoning_content message must be untouched');
}

// undefined signature on a completions turn -> default reasoning_content.
{
  const out = normalizeReasoningChannelMessages([toolCallAssistant(undefined)], 0);
  assert.equal(sigOf(out[0]), 'reasoning_content', 'missing signature defaults to reasoning_content');
}

// JSON reasoning-details signature must be preserved (pi-ai preserved-details path).
{
  const details = JSON.stringify([{ type: 'reasoning.text', text: 'x', signature: 'sig' }]);
  const out = normalizeReasoningChannelMessages([toolCallAssistant(details)], 0);
  assert.equal(sigOf(out[0]), details, 'JSON details signature must not be flattened');
}

// non-completions api: reasoning_content stripped, other signatures preserved.
{
  const out = normalizeReasoningChannelMessages([toolCallAssistant('reasoning_content', 'anthropic-messages')], 0);
  assert.equal(sigOf(out[0]), undefined, 'non-completions drops reasoning_content signature');
  const out2 = normalizeReasoningChannelMessages([toolCallAssistant('reasoning', 'anthropic-messages')], 0);
  assert.equal(sigOf(out2[0]), 'reasoning', 'non-completions keeps non-alias signature');
}

// scope: messages before scopeStart are not touched.
{
  const old = toolCallAssistant('reasoning');
  const out = normalizeReasoningChannelMessages([old], 1);
  assert.equal(out[0], old, 'out-of-scope message untouched');
}

console.log('signature-normalize: all assertions passed');