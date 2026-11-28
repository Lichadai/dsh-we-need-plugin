import assert from 'node:assert/strict';
import {
  injectSeed, fillAssistantContent, hasSeedAfter, reasoningTextOf, wireMessage,
  SEED, buildOrientationSeedBlock, orientationFillHead, lastTodos, lastAssistantReasoning,
  orientationMode, ORIENTATION_LABEL, ORIENTATION_END, ORIENTATION_CONTINUE, ORIENTATION_PREVIOUS_HEAD, ORIENTATION_TASKS_HEAD,
} from '../index.js';

const OPTIONS = { provider: 'opendesign', model: 'deepseek-v4.1-flash', maxTokens: 300000 };
const MODEL = { name: 'DeepSeek-V4.1-Flash' };
const textOf = (m) => Array.isArray(m.content)
  ? m.content.filter((b) => b?.type === 'text' || b?.type === undefined).map((b) => b.text || '').join('')
  : String(m.content || '');
const user = (t) => ({ role: 'user', content: [{ type: 'text', text: t }], source: { kind: 'user' } });
function plainTurn(reasoning) {
  return {
    role: 'assistant',
    content: [{ type: 'reasoning', text: reasoning }],
    source: { kind: 'model', replayState: { response: { api: 'openai-completions' }, blocks: [{ type: 'reasoning', thinkingSignature: 'reasoning_content' }] } },
  };
}
function toolTurn(reasoning, id = 'c1') {
  const content = [];
  const blocks = [];
  if (reasoning) {
    content.push({ type: 'reasoning', text: reasoning });
    blocks.push({ type: 'reasoning', thinkingSignature: 'reasoning_content' });
  }
  content.push({ type: 'tool-call', id, name: 'read', arguments: {} });
  blocks.push({ type: 'tool-call' });
  return { role: 'assistant', content, source: { kind: 'model', replayState: { response: { api: 'openai-completions' }, blocks } } };
}
function todoTurn(todos, reasoning = 'Need update the list.') {
  const content = [];
  const blocks = [];
  if (reasoning) {
    content.push({ type: 'reasoning', text: reasoning });
    blocks.push({ type: 'reasoning', thinkingSignature: 'reasoning_content' });
  }
  content.push({ type: 'tool-call', id: 't1', name: 'todo_write', arguments: JSON.stringify({ todos }) });
  blocks.push({ type: 'tool-call' });
  return { role: 'assistant', content, source: { kind: 'model', replayState: { response: { api: 'openai-completions' }, blocks } } };
}
const toolResult = (id, t) => ({ role: 'tool', toolCallId: id, content: t });
const seedOf = (msgs) => msgs.find((m) => m?.role === 'assistant' && String(m.id ?? '').startsWith('weneed-seed-'));
const flags = (mode, usage) => ({ orientation: { mode, usage } });

// 1. mode normalization
assert.equal(orientationMode(undefined), 'off');
assert.equal(orientationMode('FULL'), 'full');
assert.equal(orientationMode('bogus'), 'off');

// 2. off is byte-identical to no orientation flag (injectSeed); seed id is random per call
{
  const msgs = [user('Need do work.')];
  const a = injectSeed(msgs, OPTIONS, MODEL);
  const b = injectSeed(msgs, OPTIONS, MODEL, undefined, false, 'we-need', false, flags('off'));
  const norm = (list) => list.map((m) => ({ ...m, id: typeof m.id === 'string' && m.id.startsWith('weneed-seed-') ? 'weneed-seed-ID' : m.id }));
  assert.deepEqual(norm(a.messages), norm(b.messages), 'off must equal baseline');
  assert.equal(textOf(seedOf(b.messages)), SEED, 'off seed content is the bare seed');
}

// 3. example mode: label + colon + newline + raw seed + continue, no quotes, no data sections
{
  const out = injectSeed([user('Need do work.')], OPTIONS, MODEL, undefined, false, 'we-need', false, flags('example'));
  const seed = seedOf(out.messages);
  const text = textOf(seed);
  assert.ok(text.startsWith(`${ORIENTATION_LABEL}\n${SEED}`), 'example leads with label colon newline then raw seed');
  assert.ok(text.includes(ORIENTATION_END), 'example closes with an explicit end boundary');
  assert.ok(text.indexOf(ORIENTATION_END) > text.indexOf(SEED), 'end boundary follows the raw seed');
  assert.ok(text.includes(ORIENTATION_CONTINUE), 'example carries continue line');
  assert.equal(text.includes(`"${SEED}"`), false, 'seed must NOT be wrapped in quotes');
  assert.equal(text.includes(ORIENTATION_PREVIOUS_HEAD), false, 'example has no previous-thinking section');
  assert.equal(reasoningTextOf(seed).trim(), text, 'reasoning channel mirrors the example block');
}

// 4. full mode with all data present
{
  const todos = [{ content: 'Need fix colors', status: 'in_progress' }, { content: 'Need verify render', status: 'pending' }];
  const msgs = [user('Need first.'), plainTurn('Need inspect the inputs.'), todoTurn(todos), user('Need continue the fix.')];
  const usage = { pressureTokens: 48200, contextWindow: 262144 };
  const out = injectSeed(msgs, OPTIONS, MODEL, undefined, false, 'we-need', false, flags('full', usage));
  const seed = seedOf(out.messages);
  const text = textOf(seed);
  assert.equal(reasoningTextOf(seed).trim(), text, 'reasoning channel mirrors the full current-state block');
  assert.ok(text.includes(`${ORIENTATION_PREVIOUS_HEAD}\nNeed update the list.`), 'full copies the latest assistant reasoning verbatim');
  assert.ok(text.includes(`${ORIENTATION_TASKS_HEAD}\n- [in_progress] Need fix colors\n- [pending] Need verify render`), 'full renders the current todo list');
  assert.ok(text.includes('48200 tokens of 262144 window (provider-measured)'), 'full carries measured context occupancy');
  const labelAt = text.indexOf(ORIENTATION_LABEL);
  const seedAt = text.indexOf(SEED);
  const endAt = text.indexOf(ORIENTATION_END);
  const previousAt = text.indexOf(ORIENTATION_PREVIOUS_HEAD);
  assert.ok(text.indexOf(ORIENTATION_TASKS_HEAD) < labelAt, 'todo must precede the seed');
  assert.ok(text.indexOf('48200 tokens of 262144 window') < labelAt, 'usage must precede the seed');
  assert.ok(labelAt > 0 && seedAt > labelAt, 'labeled seed follows todo/usage');
  assert.ok(endAt > seedAt, 'end boundary follows the seed');
  assert.ok(previousAt > endAt, 'previous thinking must follow the end boundary');
  assert.ok(text.indexOf(ORIENTATION_CONTINUE) > previousAt, 'continue stays last');
}

// 5. full mode first turn (no assistant / no todos / no usage) degrades to example shape
{
  const out = injectSeed([user('Need first task.')], OPTIONS, MODEL, undefined, false, 'we-need', false, flags('full', undefined));
  const text = textOf(seedOf(out.messages));
  assert.equal(text, `${ORIENTATION_LABEL}\n${SEED}\n\n${ORIENTATION_END}\n\n${ORIENTATION_CONTINUE}`, 'missing data sections are omitted, never invented');
}

// 6. full mode partial data: previous reasoning present, todos/usage absent
{
  const msgs = [user('Need first.'), plainTurn('Need earlier plan.'), user('Need continue.')];
  const text = textOf(seedOf(injectSeed(msgs, OPTIONS, MODEL, undefined, false, 'we-need', false, flags('full')).messages));
  assert.ok(text.includes(`${ORIENTATION_PREVIOUS_HEAD}\nNeed earlier plan.`), 'previous thinking present');
  assert.equal(text.includes(ORIENTATION_TASKS_HEAD), false, 'no todo history -> section omitted');
  assert.equal(text.includes('provider-measured'), false, 'no usage -> section omitted');
}

// 7. isSeed still strips the orientation seed; re-injection keeps exactly one seed with identical content
{
  const msgs = [user('Need first.'), plainTurn('Need plan.'), user('Need continue.')];
  const once = injectSeed(msgs, OPTIONS, MODEL, undefined, false, 'we-need', false, flags('full'));
  const twice = injectSeed(once.messages, OPTIONS, MODEL, undefined, false, 'we-need', false, flags('full'));
  const seeds = twice.messages.filter((m) => m?.role === 'assistant' && String(m.id ?? '').startsWith('weneed-seed-'));
  assert.equal(seeds.length, 1, 'old orientation seed stripped, exactly one seed');
  assert.equal(textOf(seeds[0]), textOf(seedOf(once.messages)), 'orientation block is deterministic across re-injection');
  assert.equal(hasSeedAfter(twice.messages, 0), true, 'hasSeedAfter still detects the seed');
}

// 8. contentFill with orientation: latest tool turn gets label+seed+continue+own reasoning
{
  const msgs = [user('Need do work.'), toolTurn('Need inspect the file.'), toolResult('c1', 'ok')];
  const out = fillAssistantContent(msgs, 'seed-continue-reasoning', 0, 'full');
  const text = textOf(out[1]);
  assert.ok(text.startsWith(`${ORIENTATION_LABEL}\n${SEED}`), 'contentFill latest turn leads with orientation label');
  assert.ok(text.includes(ORIENTATION_CONTINUE), 'contentFill carries continue');
  assert.ok(text.includes('Need inspect the file.'), 'contentFill keeps own reasoning appended');
  assert.equal(reasoningTextOf(out[1]).trim(), 'Need inspect the file.', 'reasoning channel unchanged');
  assert.equal(out[1].source.replayState.blocks.length, out[1].content.length, 'replay blocks aligned');
  const wire = wireMessage(out[1], false, false);
  assert.ok(wire.content.includes(ORIENTATION_LABEL), 'wire content carries orientation');
  assert.equal(wire.reasoning_content, 'Need inspect the file.', 'wire reasoning_content preserved');
}

// 9. contentFill orientation off is byte-identical to the 3-arg call; older turns mirror only
{
  const msgs = [user('Need do work.'), toolTurn('Need older.', 'c0'), toolResult('c0', 'ok0'), toolTurn('Need latest.', 'c1'), toolResult('c1', 'ok1')];
  const base = fillAssistantContent(msgs, 'seed-continue-reasoning', 0);
  const off = fillAssistantContent(msgs, 'seed-continue-reasoning', 0, 'off');
  assert.deepEqual(off, base, 'orientMode off must equal baseline contentFill');
  const full = fillAssistantContent(msgs, 'seed-continue-reasoning', 0, 'full');
  assert.equal(textOf(full[1]), 'Need older.', 'older empty turn still mirrors reasoning only');
  assert.equal(textOf(full[1]).includes(SEED), false, 'older turn must not repeat seed');
}

// 10. contentFill idempotent with orientation
{
  const msgs = [user('Need do work.'), toolTurn('Need inspect.'), toolResult('c1', 'ok')];
  const once = fillAssistantContent(msgs, 'seed-continue-reasoning', 0, 'example');
  const twice = fillAssistantContent(once, 'seed-continue-reasoning', 0, 'example');
  assert.equal(twice, once, 'second pass no-op');
  assert.equal(textOf(twice[1]).split(SEED).length - 1, 1, 'seed appears exactly once');
}

// 11. lastTodos extracts the latest whole list; null when absent; parses string args
{
  const older = todoTurn([{ content: 'Need old', status: 'completed' }]);
  const newer = todoTurn([{ content: 'Need new', status: 'pending' }]);
  assert.deepEqual(lastTodos([user('t'), older, toolResult('t1', 'ok'), newer]), [{ content: 'Need new', status: 'pending' }], 'latest list wins');
  assert.equal(lastTodos([user('t'), plainTurn('Need plan.')]), null, 'no todo_write -> null');
}

// 12. lastAssistantReasoning returns latest non-seed reasoning, empty when none
{
  assert.equal(lastAssistantReasoning([user('t'), plainTurn('Need first.'), plainTurn('Need second.')]), 'Need second.');
  assert.equal(lastAssistantReasoning([user('t')]), '');
}

// 13. orientation meta text carries no drift literals
{
  const forbidden = [['L', 'e', 't', ' ', 'm', 'e'].join(''), ['I', ' ', 'will'].join(''), ['I', "'", 'll'].join(''), ['let', ' ', 'us'].join(''), ['let', 'me'].join('-')];
  const meta = [ORIENTATION_LABEL, ORIENTATION_END, ORIENTATION_CONTINUE, ORIENTATION_PREVIOUS_HEAD, ORIENTATION_TASKS_HEAD, orientationFillHead()].join('\n');
  for (const phrase of forbidden) {
    const pattern = new RegExp(`\\b${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+')}\\b`, 'i');
    assert.equal(pattern.test(meta), false, `orientation meta must not contain ${phrase}`);
  }
}

// 14. projection-sourced todos override history (host current list wins); fallback to history when absent
{
  const historyTodos = [{ content: 'Need old history step', status: 'completed' }];
  const msgs = [user('Need first.'), todoTurn(historyTodos), user('Need continue.')];
  const projectionTodos = [{ content: 'Need current system step', status: 'in_progress' }];
  const withProj = buildOrientationSeedBlock(msgs, 'full', undefined, projectionTodos);
  assert.ok(withProj.includes('- [in_progress] Need current system step'), 'projection list must win over history');
  assert.equal(withProj.includes('Need old history step'), false, 'history list must not appear when projection present');
  const noProj = buildOrientationSeedBlock(msgs, 'full', undefined, undefined);
  assert.ok(noProj.includes('- [completed] Need old history step'), 'falls back to history when projection absent');
  const emptyProj = buildOrientationSeedBlock(msgs, 'full', undefined, []);
  assert.ok(emptyProj.includes('- [completed] Need old history step'), 'empty projection falls back to history');
}

console.log('orientation: all assertions passed');