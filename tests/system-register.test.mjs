import assert from 'node:assert/strict';
import { appendSystemRegister, SYSTEM_REGISTER_HEAD } from '../index.js';

const sysString = { role: 'system', content: 'You are a coding agent.' };
const once = appendSystemRegister([sysString], true);
assert.notEqual(once, [sysString], 'enabled must return a new messages array');
assert.ok(once[0].content.includes(SYSTEM_REGISTER_HEAD), 'string system must receive register');
assert.equal(appendSystemRegister(once, true)[0].content.split(SYSTEM_REGISTER_HEAD).length - 1, 1, 'string append must be idempotent');

const sysArray = { role: 'system', content: [{ type: 'text', text: 'You are a coding agent.' }] };
const arrayOnce = appendSystemRegister([sysArray], true);
assert.equal(arrayOnce[0].content.length, 2, 'array system must receive a text block');
assert.ok(arrayOnce[0].content[1].text.includes(SYSTEM_REGISTER_HEAD), 'array block must carry register');
assert.equal(appendSystemRegister(arrayOnce, true)[0].content.length, 2, 'array append must be idempotent');

const input = [sysString];
assert.equal(appendSystemRegister(input, false), input, 'disabled must be a no-op');
assert.equal(appendSystemRegister([{ role: 'user', content: 'x' }], true)[0].role, 'user', 'no system means no mutation');
console.log('system-register: all assertions passed');
