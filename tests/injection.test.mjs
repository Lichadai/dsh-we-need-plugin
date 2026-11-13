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
  mirrorMessages,
  wireMessage,
  anchorEmptyToolPlan,
  anchorAfterCompaction,
  hasSeedAfter,
  appendTaskPolicy,
  TASK_POLICY,
  TOOL_STEP_ANCHOR,
  taskScopeStart,
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

const policyInput = [system('system prompt'), user('task')];
const policied = appendTaskPolicy(policyInput, true);
assert.equal(policied.length, 2);
assert.ok(policied[1].content.map((block) => block.text || '').join('').includes(TASK_POLICY));
assert.equal(appendTaskPolicy(policied, true), policied);
assert.equal(appendTaskPolicy(policyInput, false), policyInput);

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

const flat = (message) => (message.content ?? []).map((block) => block.text || '').join('');
const runtimeContext = user('Current runtime context. workspace D:\\weneed');
const toolStepOrdered = injectSeed(
  [system('system prompt'), user('task'), runtimeContext, assistantTool(), tool()],
  OPTIONS,
  MODEL,
);
assert.equal(toolStepOrdered.reason, 'tool-step');
assert.equal(toolStepOrdered.injected, false);
assert.equal(toolStepOrdered.messages.length, 5);
assert.deepEqual(toolStepOrdered.messages.map((message) => message.role),
  ['system', 'user', 'user', 'assistant', 'tool']);
assert.equal(flat(toolStepOrdered.messages[1]).startsWith('Current runtime context.'), true);
assert.equal(flat(toolStepOrdered.messages[2]), 'task');
assert.equal(toolStepOrdered.messages[3].content[0].type, 'tool-call');
assert.deepEqual(injectSeed(toolStepOrdered.messages, OPTIONS, MODEL).messages, toolStepOrdered.messages);

const compactionAfterTask = injectSeed(
  [user('task'), user('<compacted-summary>checkpoint</compacted-summary>'), runtimeContext, assistantTool(), tool()],
  OPTIONS,
  MODEL,
);
assert.equal(compactionAfterTask.reason, 'tool-step');
assert.deepEqual(compactionAfterTask.messages.map((message) => message.role),
  ['user', 'user', 'user', 'assistant', 'tool']);
assert.equal(flat(compactionAfterTask.messages[0]), 'task');
assert.equal(flat(compactionAfterTask.messages[1]).startsWith('<compacted-summary>'), true);
assert.equal(flat(compactionAfterTask.messages[2]).startsWith('Current runtime context.'), true);

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
let lastDelegatedMessages;
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
          lastDelegatedMessages = options.messages;
          const seeded = options.messages.some((message) => message.role === 'assistant'
            && message.content?.some((block) => block.type === 'reasoning' && block.text?.startsWith(SEED.slice(0, 24))));
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

await runDelegated({
  provider: 'any-provider',
  model: 'deepseek-v4-flash',
  messages: [
    system('system prompt'),
    user('task'),
    { role: 'assistant', content: [{ type: 'reasoning', text: 'R1' }] },
    user('follow-up'),
  ],
});
const delegatedOldTaskAssistant = lastDelegatedMessages.find((message) => message.role === 'assistant'
  && message.content?.some((block) => block.type === 'reasoning' && block.text === 'R1'));
assert.ok(delegatedOldTaskAssistant);
assert.equal(delegatedOldTaskAssistant.content.some((block) => block.type === 'text' && block.text === 'R1'), false);

const oldDelegatedTool = {
  role: 'assistant',
  content: [
    { type: 'reasoning', text: 'OLDER TASK PLAN' },
    { type: 'tool-call', id: 'older', name: 'read', arguments: '{}' },
  ],
};
await runDelegated({
  provider: 'any-provider',
  model: 'deepseek-v4-flash',
  messages: [
    system('system prompt'),
    user('old task'),
    oldDelegatedTool,
    { role: 'tool', content: text('old result'), toolCallId: 'older' },
    user('new task'),
  ],
});
const oldDelegatedAfter = lastDelegatedMessages.find((message) => message.content
  ?.some((block) => block.type === 'tool-call' && block.id === 'older'));
assert.ok(oldDelegatedAfter);
assert.equal(oldDelegatedAfter.content.some((block) => block.type === 'text' && block.text === 'OLDER TASK PLAN'), false);

const scopeHandlers = [];
let scopeCalls = 0;
let scopeMessages;
const scopeCtx = {
  llm: {
    registerAdapter() { throw new Error('delegated release must not register a provider'); },
    async prepareCall(config) {
      scopeCalls += 1;
      return {
        config: { provider: config.provider, model: config.model },
        stream: async function* (options) {
          scopeMessages = options.messages;
          yield { type: 'text-delta', text: 'scope' };
        },
      };
    },
  },
  on(event, handler) {
    if (event === 'llm/stream') scopeHandlers.push(handler);
  },
  get() {},
};
apply(scopeCtx, { intercept: true, targetRules: DEFAULT_TARGET_RULES });
const runScope = async (options) => {
  const chunks = [];
  for await (const chunk of scopeHandlers[0](options, async function* () {
    yield { type: 'text-delta', text: 'next' };
  })) chunks.push(chunk);
  return chunks;
};
const scopeToolTurn = {
  role: 'assistant',
  content: [
    { type: 'reasoning', text: 'We need read.' },
    { type: 'tool-call', id: 'call-1', name: 'read', arguments: '{}' },
  ],
};
const scopeToolResult = { role: 'tool', content: text('result'), toolCallId: 'call-1' };
const scopeTask = [system('system prompt'), user('task'), scopeToolTurn, scopeToolResult];

// A tool-step request with only tool-call assistant turns still delegates.
assert.deepEqual(await runScope({
  provider: 'any-provider',
  model: 'deepseek-v4-flash',
  messages: scopeTask,
}), [{ type: 'text-delta', text: 'next' }]);
assert.equal(scopeCalls, 0);

// A non-tool assistant turn is mirrored on a tool-step request, even without a seed.
const priorAnswer = { role: 'assistant', content: [{ type: 'reasoning', text: 'R0' }] };
assert.deepEqual(await runScope({
  provider: 'any-provider',
  model: 'deepseek-v4-flash',
  messages: [system('system prompt'), user('task'), priorAnswer, ...scopeTask.slice(2)],
}), [{ type: 'text-delta', text: 'scope' }]);
assert.equal(scopeCalls, 1);
const scopedAnswer = scopeMessages.find((message) => message.role === 'assistant'
  && message.content?.some((block) => block.type === 'text' && block.text === 'R0'));
assert.ok(scopedAnswer);

const toolHandlers = [];
let toolCalls = 0;
let toolMessages;
const toolCtx = {
  llm: {
    registerAdapter() { throw new Error('delegated release must not register a provider'); },
    async prepareCall(config) {
      toolCalls += 1;
      return {
        config: { provider: config.provider, model: config.model },
        stream: async function* (options) {
          toolMessages = options.messages;
          yield { type: 'text-delta', text: 'tool-scope' };
        },
      };
    },
  },
  on(event, handler) {
    if (event === 'llm/stream') toolHandlers.push(handler);
  },
  get() {},
};
apply(toolCtx, { intercept: true, targetRules: DEFAULT_TARGET_RULES, mirrorToolSteps: true, taskPolicy: true });
const runTool = async (options) => {
  const chunks = [];
  for await (const chunk of toolHandlers[0](options, async function* () {
    yield { type: 'text-delta', text: 'next' };
  })) chunks.push(chunk);
  return chunks;
};
assert.deepEqual(await runTool({
  provider: 'any-provider',
  model: 'deepseek-v4-flash',
  messages: scopeTask,
}), [{ type: 'text-delta', text: 'tool-scope' }]);
assert.equal(toolCalls, 1);
const mirroredToolTurn = toolMessages.find((message) => message.role === 'assistant'
  && message.content?.some((block) => block.type === 'tool-call'));
assert.ok(mirroredToolTurn);
assert.ok(mirroredToolTurn.content.some((block) => block.type === 'text' && block.text === 'We need read.'));
assert.equal(toolMessages.filter((message) => message.role === 'user').length, 1);
assert.ok(flat(toolMessages.find((message) => message.role === 'user')).includes(TASK_POLICY));
assert.ok(!toolMessages.some((message) => message.role === 'assistant'
  && !message.content.some((block) => block.type === 'tool-call')));

const assistantTrace = (reasoning, extra = []) => ({
  role: 'assistant',
  content: [{ type: 'reasoning', text: reasoning }, ...extra],
});
const mirrored = mirrorMessages([assistantTrace('R1')]);
assert.deepEqual(mirrored[0].content, [
  { type: 'text', text: 'R1' },
  { type: 'reasoning', text: 'R1' },
]);
const toolTurn = assistantTrace('R1', [
  { type: 'tool-call', id: 'call-1', name: 'read', arguments: '{}' },
]);
assert.equal(mirrorMessages([toolTurn])[0], toolTurn);
assert.equal(mirrorMessages([toolTurn], true, false)[0], toolTurn);
const mirroredTool = mirrorMessages([toolTurn], true, true)[0];
assert.deepEqual(mirroredTool.content, [
  { type: 'text', text: 'R1' },
  { type: 'reasoning', text: 'R1' },
  { type: 'tool-call', id: 'call-1', name: 'read', arguments: '{}' },
]);
// OpenDesign may carry thinking only in reasoning_details, with no reasoning
// block. That channel must still feed the mirror.
const detailsOnly = {
  role: 'assistant',
  content: [{ type: 'tool-call', id: 'call-2', name: 'read', arguments: '{}' }],
  reasoning_details: [{ index: 0, type: 'reasoning.text', text: 'D1' }],
};
const mirroredDetails = mirrorMessages([detailsOnly], true, true)[0];
assert.deepEqual(mirroredDetails.content, [
  { type: 'text', text: 'D1' },
  { type: 'tool-call', id: 'call-2', name: 'read', arguments: '{}' },
]);
// The wire must read the same details fallback; otherwise the mirror lands in
// content while reasoning_content stays empty for details-only tool steps.
const detailsWire = wireMessage(mirroredDetails, true, true);
assert.equal(detailsWire.content, 'D1');
assert.equal(detailsWire.reasoning_content, 'D1');
assert.deepEqual(detailsWire.tool_calls, [{
  id: 'call-2',
  type: 'function',
  function: { name: 'read', arguments: '{}' },
}]);
const detailsWireNoMirror = wireMessage(detailsOnly, false, false);
assert.equal(detailsWireNoMirror.content, '');
assert.equal(detailsWireNoMirror.reasoning_content, 'D1');

const emptyPlanTurn = {
  role: 'assistant',
  content: [
    { type: 'reasoning', text: '' },
    { type: 'tool-call', id: 'call-1', name: 'read', arguments: '{}' },
  ],
  source: {
    kind: 'model',
    provider: 'opendesign',
    model: 'deepseek-v4.1-flash',
    replayState: {
      response: { kind: 'pi-ai', version: 2, api: 'openai-completions', provider: 'opendesign', model: 'deepseek-v4.1-flash', stopReason: 'toolUse' },
      blocks: [{ type: 'reasoning', thinkingSignature: 'reasoning_content' }, { type: 'tool-call' }],
    },
  },
};
const anchorResult = { role: 'tool', content: text('result'), toolCallId: 'call-1' };
const anchorStep = [system('system prompt'), user('task'), emptyPlanTurn, anchorResult];
assert.equal(anchorEmptyToolPlan(anchorStep, 'off'), anchorStep);
assert.equal(anchorEmptyToolPlan(anchorStep, 'reasoning') !== anchorStep, true);
const anchoredReasoning = anchorEmptyToolPlan(anchorStep, 'reasoning')[2];
assert.deepEqual(anchoredReasoning.content.map((block) => block.type), ['reasoning', 'reasoning', 'tool-call']);
assert.equal(anchoredReasoning.content[0].text, TOOL_STEP_ANCHOR);
assert.deepEqual(anchoredReasoning.source.replayState.blocks.map((block) => block.type), ['reasoning', 'reasoning', 'tool-call']);
assert.equal(anchoredReasoning.source.replayState.blocks[0].thinkingSignature, 'reasoning_content');
const anchoredReasoningWire = wireMessage(anchoredReasoning, true, false);
assert.equal(anchoredReasoningWire.content, '');
assert.equal(anchoredReasoningWire.reasoning_content, TOOL_STEP_ANCHOR);
const anchoredContent = anchorEmptyToolPlan(anchorStep, 'content')[2];
assert.deepEqual(anchoredContent.content.map((block) => block.type), ['text', 'reasoning', 'tool-call']);
const anchoredContentWire = wireMessage(anchoredContent, true, true);
assert.equal(anchoredContentWire.content, TOOL_STEP_ANCHOR);
assert.equal(anchoredContentWire.reasoning_content, '');
assert.equal(wireMessage(anchoredContent, true, false).content, '');
const anchoredBoth = anchorEmptyToolPlan(anchorStep, 'both')[2];
assert.deepEqual(anchoredBoth.content.map((block) => block.type), ['text', 'reasoning', 'reasoning', 'tool-call']);
const anchoredBothWire = wireMessage(anchoredBoth, true, true);
assert.equal(anchoredBothWire.content, TOOL_STEP_ANCHOR);
assert.equal(anchoredBothWire.reasoning_content, TOOL_STEP_ANCHOR);
assert.equal(wireMessage(anchoredBoth, true, false).content, '');
assert.equal(anchorEmptyToolPlan([system('s'), user('task'), toolTurn, anchorResult], 'both')[2], toolTurn);
assert.equal(anchorEmptyToolPlan(anchorStep, 'unknown'), anchorStep);


const legacyOpening = ['L', 'e', 't', ' ', 'm', 'e'].join('');
const I_LL = ['I', "'", 'll'].join('');
const I_WILL = ['I', ' ', 'will'].join('');
const LET_US = ['let', ' ', 'us'].join('');
const oldToolTurn = {
  role: 'assistant',
  content: [
    { type: 'reasoning', text: 'OLD TASK PLAN' },
    { type: 'tool-call', id: 'old1', name: 'read', arguments: '{}' },
  ],
};
const oldToolResult = { role: 'tool', content: text('old result'), toolCallId: 'old1' };
const oldFinal = { role: 'assistant', content: [{ type: 'text', text: 'old answer' }, { type: 'reasoning', text: 'OLD FINAL' }] };
const currentToolTurn = {
  role: 'assistant',
  content: [
    { type: 'reasoning', text: 'CURRENT TASK PLAN' },
    { type: 'tool-call', id: 'cur1', name: 'read', arguments: '{}' },
  ],
};
const currentToolResult = { role: 'tool', content: text('current result'), toolCallId: 'cur1' };
const crossTask = [
  system('system prompt'),
  user('old task'),
  oldToolTurn,
  oldToolResult,
  oldFinal,
  user('new task'),
  currentToolTurn,
  currentToolResult,
];
assert.equal(taskScopeStart(crossTask), 6);
const scopedCrossTask = mirrorMessages(crossTask, true, true, 6);
assert.equal(scopedCrossTask[2], oldToolTurn);
assert.notEqual(scopedCrossTask[6], currentToolTurn);
assert.ok(scopedCrossTask[6].content.some((block) => block.type === 'text' && block.text === 'CURRENT TASK PLAN'));
const allScope = mirrorMessages(crossTask, true, true, 0);
assert.notEqual(allScope[2], oldToolTurn);
assert.ok(allScope[2].content.some((block) => block.type === 'text' && block.text === 'OLD TASK PLAN'));

const oldEmpty = {
  role: 'assistant',
  content: [
    { type: 'reasoning', text: '' },
    { type: 'tool-call', id: 'old-empty', name: 'read', arguments: '{}' },
  ],
};
const currentEmpty = {
  role: 'assistant',
  content: [
    { type: 'reasoning', text: '' },
    { type: 'tool-call', id: 'current-empty', name: 'read', arguments: '{}' },
  ],
};
const currentEmptyResult = { role: 'tool', content: text('result'), toolCallId: 'current-empty' };
const anchorScopeMessages = [
  system('system prompt'),
  user('old task'),
  oldEmpty,
  oldToolResult,
  user('new task'),
  currentEmpty,
  currentEmptyResult,
];
assert.equal(taskScopeStart(anchorScopeMessages), 5);
const anchorScoped = anchorEmptyToolPlan(anchorScopeMessages, 'both', TOOL_STEP_ANCHOR, 5);
assert.equal(anchorScoped[2], oldEmpty);
assert.notEqual(anchorScoped[5], currentEmpty);
assert.ok(anchorScoped[5].content.some((block) => block.type === 'text' && block.text === TOOL_STEP_ANCHOR));

const compactMessages = [
  system('system prompt'),
  user('old task'),
  oldToolTurn,
  oldToolResult,
  user('<compacted-summary>checkpoint</compacted-summary>'),
  currentToolTurn,
  currentToolResult,
];
assert.equal(taskScopeStart(compactMessages), 5);
const compactMirrored = mirrorMessages(compactMessages, true, true, 5);
assert.equal(compactMirrored[2], oldToolTurn);
assert.notEqual(compactMirrored[5], currentToolTurn);

const compactCurrentTool = {
  ...currentToolTurn,
  source: {
    kind: 'model',
    provider: 'opendesign',
    model: 'deepseek-v4.1-flash',
    replayState: {
      response: { kind: 'pi-ai', version: 2, api: 'openai-completions', provider: 'opendesign', model: 'deepseek-v4.1-flash', stopReason: 'toolUse' },
      blocks: [{ type: 'reasoning', thinkingSignature: 'reasoning_content' }, { type: 'tool-call' }],
    },
  },
};
const compactionStep = [
  system('system prompt'),
  user('old task'),
  oldToolTurn,
  oldToolResult,
  user('<compacted-summary>checkpoint</compacted-summary>'),
  compactCurrentTool,
  currentToolResult,
];
const postCompactionSeeded = anchorAfterCompaction(compactionStep, 'reasoning');
assert.notEqual(postCompactionSeeded, compactionStep);
const seededTool = postCompactionSeeded[5];
assert.deepEqual(seededTool.content.map((block) => block.type), ['reasoning', 'reasoning', 'tool-call']);
assert.equal(seededTool.content[0].text, SEED);
assert.deepEqual(seededTool.source.replayState.blocks.map((block) => block.type), ['reasoning', 'reasoning', 'tool-call']);
assert.equal(seededTool.source.replayState.blocks[0].thinkingSignature, 'reasoning_content');
assert.equal(hasSeedAfter(postCompactionSeeded, 5), true);
assert.equal(anchorAfterCompaction(postCompactionSeeded, 'reasoning'), postCompactionSeeded);
assert.equal(anchorAfterCompaction(compactionStep, 'off'), compactionStep);
const bothSeededTool = anchorAfterCompaction(compactionStep, 'both')[5];
assert.deepEqual(bothSeededTool.content.map((block) => block.type), ['text', 'reasoning', 'reasoning', 'tool-call']);
const newTaskAfterCompaction = [
  system('system prompt'),
  user('old task'),
  oldToolTurn,
  oldToolResult,
  user('<compacted-summary>checkpoint</compacted-summary>'),
  user('new task'),
  currentToolTurn,
  currentToolResult,
];
assert.equal(anchorAfterCompaction(newTaskAfterCompaction, 'reasoning'), newTaskAfterCompaction);
const answeredTurn = {
  role: 'assistant',
  content: [{ type: 'text', text: 'answer' }, { type: 'reasoning', text: 'R1' }],
};
assert.equal(mirrorMessages([answeredTurn])[0], answeredTurn);
const noReasoningTurn = { role: 'assistant', content: [{ type: 'text', text: '' }] };
assert.equal(mirrorMessages([noReasoningTurn])[0], noReasoningTurn);
const disabledMirror = mirrorMessages([assistantTrace('R1')], false);
assert.equal(disabledMirror[0].content.length, 1);
assert.equal(disabledMirror[0].content[0].type, 'reasoning');

const replayTurn = {
  ...assistantTrace('R1'),
  source: {
    kind: 'model',
    provider: 'opendesign',
    model: 'deepseek-v4.1-flash',
    replayState: {
      response: { kind: 'pi-ai', version: 2, api: 'openai-completions', provider: 'opendesign', model: 'deepseek-v4.1-flash', stopReason: 'stop' },
      blocks: [{ type: 'reasoning', thinkingSignature: 'reasoning_content' }],
    },
  },
};
const replayMirrored = mirrorMessages([replayTurn])[0];
assert.deepEqual(replayMirrored.source.replayState.blocks, [
  { type: 'text' },
  { type: 'reasoning', thinkingSignature: 'reasoning_content' },
]);
const toolReplayTurn = {
  ...toolTurn,
  source: {
    ...replayTurn.source,
    replayState: {
      ...replayTurn.source.replayState,
      response: { ...replayTurn.source.replayState.response, stopReason: 'toolUse' },
      blocks: [
        { type: 'reasoning', thinkingSignature: 'reasoning_content' },
        { type: 'tool-call' },
      ],
    },
  },
};
const toolReplayMirrored = mirrorMessages([toolReplayTurn], true, true)[0];
assert.deepEqual(toolReplayMirrored.source.replayState.blocks, [
  { type: 'text' },
  { type: 'reasoning', thinkingSignature: 'reasoning_content' },
  { type: 'tool-call' },
]);

const wireNormal = wireMessage(assistantTrace('R1'));
assert.deepEqual(wireNormal, { role: 'assistant', content: 'R1', reasoning_content: 'R1' });
const wireTool = wireMessage(toolTurn);
assert.equal(wireTool.content, '');
assert.equal(wireTool.reasoning_content, 'R1');
assert.deepEqual(wireTool.tool_calls, [{
  id: 'call-1',
  type: 'function',
  function: { name: 'read', arguments: '{}' },
}]);
const wireToolMirrored = wireMessage(toolTurn, true, true);
assert.equal(wireToolMirrored.content, 'R1');
assert.equal(wireToolMirrored.reasoning_content, 'R1');
assert.deepEqual(wireToolMirrored.tool_calls, wireTool.tool_calls);
assert.equal(wireMessage(toolTurn, true, false).content, '');
const toolTurnWithText = {
  role: 'assistant',
  content: [
    { type: 'text', text: 'visible plan' },
    { type: 'reasoning', text: 'R2' },
    { type: 'tool-call', id: 'call-2', name: 'read', arguments: '{"path":"a"}' },
  ],
};
const wireToolText = wireMessage(toolTurnWithText, false, false);
assert.equal(wireToolText.content, '');
assert.equal(wireToolText.reasoning_content, 'R2');
assert.deepEqual(wireToolText.tool_calls, [{
  id: 'call-2',
  type: 'function',
  function: { name: 'read', arguments: '{"path":"a"}' },
}]);
assert.equal(wireMessage(toolTurnWithText, true, false).content, '');
assert.equal(wireMessage(toolTurnWithText, true, true).content, 'visible plan');
const wireNoMirror = wireMessage(assistantTrace('R1'), false);
assert.equal(wireNoMirror.content, '');

console.log('PASS release injection, compaction, tool-step, old-seed strip, non-target');
console.log('PASS release target rules and optional provider-scoped intercept routes');
console.log('PASS provider-agnostic delegated mode: any provider, model-id match, bypass guard');
console.log('PASS mirror: every target request, normal assistant, opt-in tool-step mirror, anchor modes');
console.log('PASS tool-step: empty DSH content, contexts before task, idempotent policy, compaction guard');
