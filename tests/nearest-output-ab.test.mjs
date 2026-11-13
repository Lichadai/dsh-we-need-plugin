import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  injectSeed,
  applyNearestGuidance,
  appendTeamRegisterHint,
  appendToolDescriptionSeed,
  NEAREST_GUIDANCE,
  TEAM_REGISTER_HINT,
  TOOL_DESC_GUIDANCE,
} from '../index.js';

const SEED = readFileSync(new URL('../seed.txt', import.meta.url), 'utf8').trim();
const MODEL = { name: 'DeepSeek-V4.1-Flash' };
const OPTIONS = { provider: 'opendesign', model: 'deepseek-v4.1-flash', maxTokens: 300000 };
const text = (v) => [{ type: 'text', text: v }];
const user = (v) => ({ role: 'user', content: text(v) });
const ctxUser = (v) => ({ role: 'user', content: text(v), source: { kind: 'runtime-context' } });
const system = (v) => ({ role: 'system', content: text(v) });
const assistantTool = (extra = []) => ({ role: 'assistant', content: [...extra, { type: 'tool-call', id: 'call-1', name: 'read', arguments: '{}' }] });
const tool = () => ({ role: 'tool', content: text('result'), toolCallId: 'call-1' });
const textOf = (m) => m.content.filter(b => b.type === 'text').map(b => b.text).join('');
const reasoningOf = (m) => m.content.filter(b => b.type === 'reasoning').map(b => b.text).join('');

// ---- Base toggles: user-task with a context AFTER the task ----
const input = [system('sys'), user('task'), ctxUser('runtime')];
// C: reorder + seed (default)
const C = injectSeed(input, OPTIONS, MODEL, undefined, false, 'we-need', false, {});
assert.equal(C.injected, true);
assert.deepEqual(C.messages.map(m => m.role), ['system', 'user', 'assistant', 'user']);
assert.equal(textOf(C.messages[1]), 'runtime'); // context moved before task
assert.equal(textOf(C.messages[3]), 'task');
// B: reorder, no seed
const B = injectSeed(input, OPTIONS, MODEL, undefined, false, 'we-need', false, { seedEnabled: false });
assert.equal(B.injected, false);
assert.deepEqual(B.messages.map(m => m.role), ['system', 'user', 'user']);
assert.equal(textOf(B.messages[1]), 'runtime');
assert.equal(textOf(B.messages[2]), 'task');
// A: no reorder, no seed (original order)
const A = injectSeed(input, OPTIONS, MODEL, undefined, false, 'we-need', false, { seedEnabled: false, reorderEnabled: false });
assert.equal(A.injected, false);
assert.deepEqual(A.messages.map(m => m.role), ['system', 'user', 'user']);
assert.equal(textOf(A.messages[1]), 'task'); // original order preserved
assert.equal(textOf(A.messages[2]), 'runtime');

// ---- Base toggles: tool-step ----
const toolInput = [system('sys'), user('task'), assistantTool(), tool()];
const Ct = injectSeed(toolInput, OPTIONS, MODEL, undefined, false, 'we-need', true, {});
assert.equal(Ct.injected, true); // reseed
assert.equal(Ct.messages[1].role, 'assistant'); // seed before task
const Bt = injectSeed(toolInput, OPTIONS, MODEL, undefined, false, 'we-need', true, { seedEnabled: false });
assert.equal(Bt.injected, false);
assert.equal(Bt.messages.some(m => m.role === 'assistant' && m.content.some(b => b.type === 'text' && b.text.includes(SEED.slice(0, 24)))), false);
const At = injectSeed(toolInput, OPTIONS, MODEL, undefined, false, 'we-need', true, { seedEnabled: false, reorderEnabled: false });
assert.equal(At.injected, false);
assert.deepEqual(At.messages.map(m => m.role), ['system', 'user', 'assistant', 'tool']);

// ---- applyNearestGuidance ----
const head = NEAREST_GUIDANCE.slice(0, 48);
const empty = [system('sys'), user('task'), assistantTool(), tool()];
assert.equal(applyNearestGuidance(empty, 'off'), empty);
const gContent = applyNearestGuidance(empty, 'content');
assert.ok(textOf(gContent[2]).includes(head), 'content filled');
assert.equal(reasoningOf(gContent[2]), '', 'reasoning untouched in content mode');
const gReason = applyNearestGuidance(empty, 'reasoning');
assert.ok(reasoningOf(gReason[2]).includes(head), 'reasoning appended');
assert.equal(textOf(gReason[2]), '', 'content untouched in reasoning mode');
const gBoth = applyNearestGuidance(empty, 'both');
assert.ok(textOf(gBoth[2]).includes(head) && reasoningOf(gBoth[2]).includes(head), 'both channels');
// idempotent
assert.equal(applyNearestGuidance(gBoth, 'both'), gBoth);
// does not overwrite model's own visible content
const spoken = [system('sys'), user('task'), assistantTool([{ type: 'text', text: 'own speech' }]), tool()];
const gSpoken = applyNearestGuidance(spoken, 'content');
assert.equal(textOf(gSpoken[2]), 'own speech');
// appends to existing reasoning, keeps it
const reasoned = [system('sys'), user('task'), assistantTool([{ type: 'reasoning', text: 'We need prior plan.' }]), tool()];
const gReasoned = applyNearestGuidance(reasoned, 'reasoning');
assert.ok(reasoningOf(gReasoned[2]).startsWith('We need prior plan.'));
assert.ok(reasoningOf(gReasoned[2]).includes(head));
// no tool-call assistant -> unchanged
const noTool = [system('sys'), user('task')];
assert.equal(applyNearestGuidance(noTool, 'both'), noTool);
// tool pair / message count preserved
assert.equal(gBoth.length, empty.length);
assert.deepEqual(gBoth[3], empty[3]);

// ---- appendTeamRegisterHint ----
const tools = [
  { name: 'send_message', description: 'Send one message to another Team member.', parameters: { type: 'object', properties: { target: { type: 'string' }, message: { type: 'string' } } } },
  { name: 'spawn_teammate', description: 'Create one named, durable teammate.', parameters: { type: 'object', properties: { name: { type: 'string' } } } },
  { name: 'subagent', description: 'Delegate a self-contained task.', parameters: { type: 'object', properties: { prompt: { type: 'string' } } } },
  { name: 'read', description: 'Read a UTF-8 text file.', parameters: { type: 'object', properties: { path: { type: 'string' } } } },
];
const hintHead = TEAM_REGISTER_HINT.slice(0, 48);
assert.equal(appendTeamRegisterHint(tools, false), tools);
const hinted = appendTeamRegisterHint(tools, true);
assert.ok(hinted[0].description.includes(hintHead), 'send_message hinted');
assert.ok(hinted[1].description.includes(hintHead), 'spawn_teammate hinted');
assert.ok(hinted[2].description.includes(hintHead), 'subagent hinted');
assert.equal(hinted[3].description, tools[3].description, 'read NOT hinted');
assert.deepEqual(hinted.map(t => t.name), tools.map(t => t.name), 'names unchanged');
assert.deepEqual(hinted[0].parameters, tools[0].parameters, 'params unchanged');
assert.ok(hinted[0].description.startsWith('Send one message to another Team member.'), 'original kept, append-only');
assert.equal(appendTeamRegisterHint(hinted, true), hinted, 'idempotent');
// English is explicit (outgoing register must be English even for a Chinese task)
assert.ok(TEAM_REGISTER_HINT.includes('in English'), 'hint requires English');
// coverage: Team dispatch / remote speech tools are hinted too
const teamTools = [
  { name: 'team_task_create', description: 'Create a task for a teammate.', parameters: {} },
  { name: 'team_task_update', description: 'Update a teammate task.', parameters: {} },
  { name: 'remote_send_message', description: 'Send a message to a remote session.', parameters: {} },
  { name: 'read', description: 'Read a UTF-8 text file.', parameters: {} },
];
const teamHinted = appendTeamRegisterHint(teamTools, true);
assert.ok(teamHinted[0].description.includes(hintHead), 'team_task_create hinted');
assert.ok(teamHinted[1].description.includes(hintHead), 'team_task_update hinted');
assert.ok(teamHinted[2].description.includes(hintHead), 'remote_send_message hinted');
assert.equal(teamHinted[3].description, teamTools[3].description, 'read still NOT hinted');

// ---- toolDescriptionSeed: persistent program-text guidance on every tool ----
const tdHead = TOOL_DESC_GUIDANCE.slice(0, 48);
assert.equal(appendToolDescriptionSeed(tools, 'off'), tools, 'off is no-op');
const tdAll = appendToolDescriptionSeed(tools, 'all');
assert.ok(tdAll.every(t => (t.description ?? '').includes(tdHead)), 'all tools hinted');
assert.deepEqual(tdAll.map(t => t.name), tools.map(t => t.name), 'td names unchanged');
assert.deepEqual(tdAll[0].parameters, tools[0].parameters, 'td params unchanged');
assert.ok(tdAll[3].description.startsWith('Read a UTF-8 text file.'), 'td original kept, append-only');
assert.equal(appendToolDescriptionSeed(tdAll, 'all'), tdAll, 'td idempotent');
const tdNested = appendToolDescriptionSeed([{ type: 'function', function: { name: 'x', description: 'Do x.', parameters: {} } }], 'all');
assert.ok(tdNested[0].function.description.includes(tdHead), 'td nested function shape');

console.log('nearest-output-ab: all assertions passed');