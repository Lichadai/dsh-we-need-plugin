import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const SEED = readFileSync(new URL('../seed.txt', import.meta.url), 'utf8').trim();
import {
  apply,
  injectSeed,
  isCompactionRequest,
  isTarget,
  DEFAULT_TARGET_RULES,
  WeNeedNativeAdapter,
} from '../index.js';

const MODEL = { name: 'DeepSeek-V4.1-Flash' };
const OPTIONS = { provider: 'opendesign', model: 'deepseek-v4.1-flash', maxTokens: 300000 };
const text = (value) => [{ type: 'text', text: value }];
const user = (value) => ({ role: 'user', content: text(value) });
const system = (value) => ({ role: 'system', content: text(value) });
const assistantTool = (name = 'read') => ({
  role: 'assistant',
  content: [{ type: 'tool-call', id: 'call-1', name, arguments: '{}' }],
});
const tool = () => ({ role: 'tool', content: text('result'), toolCallId: 'call-1' });
const seedLength = (message) => ({
  content: message.content.find((block) => block.type === 'text')?.text?.length,
  reasoning: message.content.find((block) => block.type === 'reasoning')?.text?.length,
});

assert.deepEqual(DEFAULT_TARGET_RULES, [['deepseek', 'flash']]);

const normal = injectSeed([system('system prompt'), user('runtime context'), user('task')], OPTIONS, MODEL);
assert.equal(normal.injected, true);
assert.equal(normal.reason, 'user-task');
assert.equal(normal.messages.length, 4);
assert.equal(normal.messages[2].role, 'assistant');
assert.equal(normal.messages[3].role, 'user');
assert.deepEqual(seedLength(normal.messages[2]), { content: SEED.length, reasoning: SEED.length });

const compactionRequest = injectSeed(
  [system('You are acting as a compaction engine. Output only the checkpoint text.')],
  OPTIONS,
  MODEL,
);
assert.equal(compactionRequest.injected, false);
assert.equal(compactionRequest.reason, 'compaction-request');

const postCompactionTask = injectSeed(
  [user('<compacted-summary>checkpoint</compacted-summary>'), user('new task')],
  OPTIONS,
  MODEL,
);
assert.equal(postCompactionTask.injected, true);
assert.deepEqual(seedLength(postCompactionTask.messages[1]), { content: SEED.length, reasoning: SEED.length });

const postCompactionTool = injectSeed(
  [user('<compacted-summary>checkpoint</compacted-summary>'), assistantTool(), tool()],
  OPTIONS,
  MODEL,
);
assert.equal(postCompactionTool.injected, false);
assert.equal(postCompactionTool.reason, 'tool-step');

const oldSeed = injectSeed([normal.messages[2], user('new task')], OPTIONS, MODEL);
assert.equal(oldSeed.injected, true);
assert.equal(oldSeed.messages.filter((message) => message.role === 'assistant'
  && !message.content.some((block) => block.type === 'tool-call')).length, 1);

const nonTarget = injectSeed(
  [system('system prompt'), user('task')],
  { ...OPTIONS, model: 'deepseek-v4-pro' },
  { name: 'DeepSeek-V4-Pro' },
);
assert.equal(nonTarget.injected, false);
assert.equal(nonTarget.reason, 'not-target');

assert.equal(isTarget('deepseek-v4.1-flash', ''), true);
assert.equal(isTarget('DeepSeek-V4.1-Flash', ''), true);
assert.equal(isTarget('deepseek-v4.1-flash-1017', 'DeepSeek-V4.1-Flash-1017'), true);
assert.equal(isTarget('deepseek-v4-flash', ''), true);
assert.equal(isTarget('deepseek-v4.1-flash', '', false), false);
assert.equal(isTarget('deepseek-v4-pro', ''), false);
assert.equal(isTarget('DEEPSEEK-Coder', ''), false);
assert.equal(isTarget('kimi-k3.1-pro', ''), false);
assert.equal(isTarget('vendor-alias', 'DeepSeek-V4.1-Flash'), false);
assert.equal(isTarget('vendor-alias', 'DeepSeek-V4.1-Flash', undefined, DEFAULT_TARGET_RULES, true), true);

const nameOnly = injectSeed(
  [system('system prompt'), user('task')],
  { ...OPTIONS, model: 'vendor-alias' },
  { name: 'DeepSeek-V4.1-Flash' },
);
assert.equal(nameOnly.injected, false);
const nameOnlyAllowed = injectSeed(
  [system('system prompt'), user('task')],
  { ...OPTIONS, model: 'vendor-alias' },
  { name: 'DeepSeek-V4.1-Flash' },
  DEFAULT_TARGET_RULES,
  true,
);
assert.equal(nameOnlyAllowed.injected, true);

const extraRules = [['deepseek', '4.1'], ['deepseek', '4', 'pro'], ['kimi', '3.1']];
assert.equal(isTarget('deepseek-v4-pro', '', undefined, extraRules), true);
assert.equal(isTarget('kimi-k3.1-pro', '', undefined, extraRules), true);

const adapter = new WeNeedNativeAdapter({
  provider: 'weneed-native',
  models: [],
  interceptModels: [
    { provider: 'opendesign', id: 'deepseek-v4.1-flash', name: 'DeepSeek-V4.1-Flash' },
    { provider: 'baicai', id: 'deepseek-v4.1-flash-1017', name: 'DeepSeek-V4.1-Flash-1017' },
    { provider: 'baicai', id: 'kimi-k3.1-pro', name: 'kimi-k3.1-pro' },
  ],
});
assert.equal(adapter.configFor('opendesign', 'deepseek-v4.1-flash').provider, 'opendesign');
assert.equal(adapter.configFor('baicai', 'deepseek-v4.1-flash-1017').provider, 'baicai');
assert.equal(adapter.configFor('d4', 'deepseek-v4.1-flash-1017'), undefined);
assert.equal(adapter.configFor('weneed-native', 'deepseek-v4.1-flash'), undefined);

assert.equal(isCompactionRequest([user('Please summarize the conversation above.')]), true);
assert.equal(isCompactionRequest([user('normal task')]), false);

const handlers = [];
let registered = 0;
const fakeCtx = {
  llm: { registerAdapter() { registered += 1; } },
  on(event, handler) {
    if (event === 'llm/stream') handlers.push(handler);
  },
  get() {},
};
const originalStream = WeNeedNativeAdapter.prototype.stream;
WeNeedNativeAdapter.prototype.stream = async function* (options) {
  yield { type: 'text-delta', text: `intercepted:${options.provider}/${options.model}` };
};
apply(fakeCtx, {
  intercept: true,
  targetRules: DEFAULT_TARGET_RULES,
  interceptModels: [
    { provider: 'opendesign', id: 'deepseek-v4.1-flash', name: 'DeepSeek-V4.1-Flash' },
    { provider: 'baicai', id: 'deepseek-v4.1-flash-1017', name: 'DeepSeek-V4.1-Flash-1017' },
  ],
});
assert.equal(registered, 0);
const runInterceptor = async (options) => {
  const chunks = [];
  for await (const chunk of handlers[0](options, async function* () {
    yield { type: 'text-delta', text: 'next' };
  })) chunks.push(chunk);
  return chunks;
};
assert.deepEqual(await runInterceptor({ provider: 'opendesign', model: 'deepseek-v4.1-flash' }), [
  { type: 'text-delta', text: 'intercepted:opendesign/deepseek-v4.1-flash' },
]);
assert.deepEqual(await runInterceptor({ provider: 'baicai', model: 'deepseek-v4.1-flash-1017' }), [
  { type: 'text-delta', text: 'intercepted:baicai/deepseek-v4.1-flash-1017' },
]);
assert.deepEqual(await runInterceptor({ provider: 'opendesign', model: 'deepseek-v4-pro' }), [
  { type: 'text-delta', text: 'next' },
]);
assert.deepEqual(await runInterceptor({ provider: 'opendesign', model: 'kimi-k3.1-pro' }), [
  { type: 'text-delta', text: 'next' },
]);
assert.deepEqual(await runInterceptor({ provider: 'weneed-native', model: 'deepseek-v4.1-flash' }), [
  { type: 'text-delta', text: 'next' },
]);
WeNeedNativeAdapter.prototype.stream = originalStream;

const delegatedHandlers = [];
let preparedCalls = 0;
const delegatedCtx = {
  llm: {
    registerAdapter() { throw new Error('delegated release must not register a provider'); },
    async prepareCall(config) {
      preparedCalls += 1;
      return {
        config: {
          provider: config.provider,
          model: config.model,
          ...(config.reasoningEffort === undefined ? {} : { reasoningEffort: config.reasoningEffort }),
          ...(config.temperature === undefined ? {} : { temperature: config.temperature }),
          ...(config.maxTokens === undefined ? {} : { maxTokens: config.maxTokens }),
          ...(config.stop === undefined ? {} : { stop: config.stop }),
        },
        stream: async function* (options) {
          const seeded = options.messages.some((message) => message.role === 'assistant'
            && message.content?.some((block) => block.type === 'reasoning' && block.text?.startsWith('We need understand')));
          yield { type: 'text-delta', text: `delegated:${options.provider}/${options.model}:${options.__weneedBypass}:${seeded}` };
        },
      };
    },
  },
  on(event, handler) {
    if (event === 'llm/stream') delegatedHandlers.push(handler);
  },
  get() {},
};
apply(delegatedCtx, { intercept: true, targetRules: DEFAULT_TARGET_RULES });
const runDelegated = async (options) => {
  const chunks = [];
  for await (const chunk of delegatedHandlers[0](options, async function* () {
    yield { type: 'text-delta', text: 'next' };
  })) chunks.push(chunk);
  return chunks;
};
assert.deepEqual(await runDelegated({
  provider: 'any-provider',
  model: 'deepseek-v4-flash',
  messages: [system('system prompt'), user('task')],
}), [{ type: 'text-delta', text: 'delegated:any-provider/deepseek-v4-flash:true:true' }]);
assert.equal(preparedCalls, 1);
assert.deepEqual(await runDelegated({
  provider: 'any-provider',
  model: 'deepseek-v4-pro',
  messages: [system('system prompt'), user('task')],
}), [{ type: 'text-delta', text: 'next' }]);
assert.equal(preparedCalls, 1);
assert.deepEqual(await runDelegated({
  provider: 'any-provider',
  model: 'vendor-alias',
  messages: [system('system prompt'), user('task')],
}), [{ type: 'text-delta', text: 'next' }]);
assert.equal(preparedCalls, 1);
assert.deepEqual(await runDelegated({
  provider: 'any-provider',
  model: 'deepseek-v4-flash',
  __weneedBypass: true,
  messages: [],
}), [{ type: 'text-delta', text: 'next' }]);
assert.equal(preparedCalls, 1);

console.log('PASS release injection, compaction, tool-step, old-seed strip, non-target');
console.log('PASS release target rules and optional provider-scoped intercept routes');
console.log('PASS provider-agnostic delegated mode: any provider, model-id match, bypass guard');
