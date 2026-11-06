/**
 * Native WeNeed seed for DeepSeek Flash models.
 *
 * This is deliberately a custom OpenAI-compatible LlmAdapter rather than a
 * pi-ai wrapper: the seed contract fixes the final JSON key order and the
 * tool-step content value, and pi-ai owns both internally.
 */
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const SEED = readFileSync(new URL('./seed.txt', import.meta.url), 'utf8').trim();
const SEED_BYTES = Buffer.byteLength(SEED);
if (SEED.length !== 728 || SEED_BYTES !== 728) {
  throw new Error(`dsh-weneed-plugin: seed must be 728/728, got ${SEED.length}/${SEED_BYTES}`);
}

const DEFAULT_TARGET_RULES = [['deepseek', 'flash']];

const CONTEXT_PREFIXES = [
  'Current runtime context.',
  'Time sampled while preparing',
  'Current working directory:',
  'Current DSH file policy:',
  'Approval prompts are disabled',
  'You are the Team Lead named',
];
const CONTEXT_INCLUDES = [
  ['A skill is a reusable set', 'available_skills'],
];
const CONTEXT_RE = [
  /^The available skill catalog changed\./i,
  /the available skill catalog changed/i,
  /\bskill catalog\b/i,
];

function textOf(message) {
  const content = message?.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((block) => ((block?.type === 'text' || block?.type === undefined) && typeof block.text === 'string'
      ? block.text
      : ''))
    .join('');
}

function reasoningOf(message) {
  const content = message?.content;
  if (!Array.isArray(content)) return '';
  return content.map((block) => (block?.type === 'reasoning' && typeof block.text === 'string' ? block.text : '')).join('');
}

function isContextUser(message) {
  if (message?.role !== 'user') return false;
  const text = textOf(message).trimStart();
  if (CONTEXT_PREFIXES.some((prefix) => text.startsWith(prefix))) return true;
  if (CONTEXT_INCLUDES.some(([a, b]) => text.includes(a) && text.includes(b))) return true;
  return CONTEXT_RE.some((re) => re.test(text));
}

function isImageUser(message) {
  if (message?.role !== 'user' || !Array.isArray(message?.content)) return false;
  return message.content.some((block) => block?.type === 'image'
    || block?.type === 'image_url'
    || block?.type === 'input_image'
    || block?.image_url);
}

function isCompaction(message) {
  if (message?.role !== 'user' && message?.role !== 'system') return false;
  const text = textOf(message);
  return text.includes('<compacted-summary>')
    || text.includes('<cb_summary>')
    || text.includes('automatically generated checkpoint')
    || (/summary of the conversation so far/i.test(text) && /<previous_(user_message|tool_call)>/i.test(text));
}

function isCompactionRequest(messages) {
  const tail = messages.slice(-3).filter((message) => message?.role === 'user' || message?.role === 'system');
  const tailText = tail.map(textOf).join('\n');
  if (/acting as a compaction engine/i.test(tailText)
    || /Condense the conversation ABOVE/i.test(tailText)
    || /Output only the checkpoint text/i.test(tailText)) return true;
  const last = messages[messages.length - 1];
  const lastText = last?.role === 'user' || last?.role === 'system'
    ? textOf(last).trim().slice(0, 400)
    : '';
  return /^(please\s+)?(summarize|summarise|write a summary of|produce a summary of)[\s\S]{0,200}\bconversation/i.test(lastText);
}

function hasToolCalls(message) {
  return message?.role === 'assistant'
    && Array.isArray(message.content)
    && message.content.some((block) => block?.type === 'tool-call');
}

function isToolStep(message) {
  return message?.role === 'tool' || hasToolCalls(message);
}

function isSeed(message) {
  if (message?.role !== 'assistant' || hasToolCalls(message)) return false;
  const text = textOf(message).trim();
  const reasoning = reasoningOf(message).trim();
  return text === SEED || reasoning === SEED;
}

function lastRealUserIndex(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message?.role === 'user'
      && !isCompaction(message)
      && !isContextUser(message)
      && !isImageUser(message)) return i;
  }
  return -1;
}

function lastNonContextIndex(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === 'user' && isContextUser(messages[i])) continue;
    return i;
  }
  return -1;
}

function isToolStepAfterContexts(messages) {
  const index = lastNonContextIndex(messages);
  if (index < 0) return false;
  const message = messages[index];
  if (isToolStep(message)) return true;
  if (!isImageUser(message)) return false;
  for (let i = index - 1; i >= 0; i--) {
    const previous = messages[i];
    if (previous?.role === 'user' && isContextUser(previous)) continue;
    if (isToolStep(previous)) return true;
    if (previous?.role === 'assistant' && !hasToolCalls(previous)
      && /processed the tool results?/i.test(textOf(previous))) continue;
    return false;
  }
  return false;
}

function isTarget(modelId, modelName, target, rules = DEFAULT_TARGET_RULES) {
  if (target === false) return false;
  const text = `${modelId ?? ''} ${modelName ?? ''}`.toLowerCase();
  const groups = Array.isArray(rules) && rules.length > 0 ? rules : DEFAULT_TARGET_RULES;
  return groups.some((terms) => Array.isArray(terms)
    && terms.length > 0
    && terms.every((term) => text.includes(String(term ?? '').toLowerCase())));
}

function flattenUserContent(message) {
  const content = message?.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const parts = [];
  for (const block of content) {
    if (typeof block?.text === 'string') parts.push(block.text);
    else if (block?.type === 'image' || block?.type === 'image_url' || block?.type === 'input_image') {
      parts.push('[image]');
    }
  }
  return parts.join('');
}

function wireToolCall(block) {
  let args = block?.arguments;
  if (typeof args !== 'string') args = JSON.stringify(args ?? {});
  return {
    id: String(block?.id ?? ''),
    type: 'function',
    function: {
      name: String(block?.name ?? ''),
      arguments: args,
    },
  };
}

function wireMessage(message) {
  if (message?.role === 'system' || message?.role === 'developer') {
    const content = textOf(message);
    return content.length === 0 ? null : { role: 'system', content };
  }
  if (message?.role === 'user') {
    return { role: 'user', content: flattenUserContent(message) };
  }
  if (message?.role === 'assistant') {
    const text = textOf(message);
    const reasoning = reasoningOf(message);
    const toolCalls = Array.isArray(message.content)
      ? message.content.filter((block) => block?.type === 'tool-call').map(wireToolCall)
      : [];
    if (toolCalls.length > 0) {
      return {
        role: 'assistant',
        content: '',
        reasoning_content: reasoning,
        tool_calls: toolCalls,
      };
    }
    return { role: 'assistant', content: text, reasoning_content: reasoning };
  }
  if (message?.role === 'tool') {
    return {
      role: 'tool',
      content: textOf(message),
      tool_call_id: String(message.toolCallId ?? message.tool_call_id ?? ''),
    };
  }
  return null;
}

function filterSkillCatalog(messages) {
  let changed = false;
  const next = messages.map((message) => {
    if (message?.role !== 'user') return message;
    const text = textOf(message);
    if (!text.includes('<available_skills>')) return message;
    let out = text;
    for (const name of ['we need', 'we-need', 'we-need-persistent']) {
      const prefix = `- \`${name}\`:`; 
      out = out.split(/\r?\n/).filter((line) => !line.startsWith(prefix)).join('\n');
    }
    if (out === text) return message;
    changed = true;
    return { ...message, content: [{ type: 'text', text: out }] };
  });
  return changed ? next : messages;
}

function seedMessage(provider, model) {
  return {
    id: `weneed-seed-${randomUUID()}`,
    role: 'assistant',
    content: [
      { type: 'text', text: SEED },
      { type: 'reasoning', text: SEED },
    ],
    source: {
      kind: 'model',
      provider,
      model,
      // pi-ai only serializes a reasoning block as reasoning_content when the
      // block carries this signature. The custom adapter ignores replayState.
      replayState: {
        response: {
          kind: 'pi-ai',
          version: 2,
          api: 'openai-completions',
          provider,
          model,
          stopReason: 'stop',
        },
        blocks: [
          { type: 'text' },
          { type: 'reasoning', thinkingSignature: 'reasoning_content' },
        ],
      },
    },
  };
}

function injectSeed(messages, options, modelConfig, targetRules = DEFAULT_TARGET_RULES) {
  const cleaned = messages.filter((message) => !isSeed(message));
  if (isCompactionRequest(cleaned)) {
    return { messages: cleaned, injected: false, reason: 'compaction-request' };
  }
  if (isToolStep(cleaned[cleaned.length - 1]) || isToolStepAfterContexts(cleaned)) {
    return { messages: cleaned, injected: false, reason: 'tool-step' };
  }
  if (options.purpose !== undefined) {
    return { messages: cleaned, injected: false, reason: 'auxiliary' };
  }
  if (Number(options.maxTokens) > 0 && Number(options.maxTokens) <= 8192 && cleaned.length <= 4) {
    return { messages: cleaned, injected: false, reason: 'title-or-suggestion' };
  }
  const taskIndex = lastRealUserIndex(cleaned);
  if (taskIndex < 0) return { messages: cleaned, injected: false, reason: 'no-user-task' };
  if (!isTarget(options.model, modelConfig?.name, modelConfig?.target, targetRules)) {
    return { messages: cleaned, injected: false, reason: 'not-target' };
  }
  const task = cleaned[taskIndex];
  const after = cleaned.slice(taskIndex + 1);
  const contexts = after.filter(isContextUser);
  const rest = after.filter((message) => !isContextUser(message));
  return {
    messages: [
      ...cleaned.slice(0, taskIndex),
      ...contexts,
      seedMessage(options.provider, options.model),
      task,
      ...rest,
    ],
    injected: true,
    reason: 'user-task',
    taskIndex,
  };
}

function mapUsage(usage) {
  if (!usage || typeof usage !== 'object') return undefined;
  const cached = usage.prompt_tokens_details?.cached_tokens;
  return {
    inputTokens: Number(usage.prompt_tokens ?? 0),
    outputTokens: Number(usage.completion_tokens ?? 0),
    ...(usage.total_tokens === undefined ? {} : { totalTokens: Number(usage.total_tokens) }),
    ...(Number(cached) > 0 ? { cacheReadTokens: Number(cached) } : {}),
  };
}

function finishReason(raw, sawContent) {
  switch (raw) {
    case 'tool_calls':
    case 'function_call': return { kind: 'tool-calls' };
    case 'length': return { kind: 'max-tokens' };
    case 'stop':
    case null:
    case undefined: return sawContent ? { kind: 'stop' } : { kind: 'stop' };
    default: return { kind: 'stop' };
  }
}

async function* parseSseData(response) {
  if (!response.body?.getReader) throw new Error('weneed-native: upstream response has no body');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        let line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (line.endsWith('\r')) line = line.slice(0, -1);
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trimStart();
        if (data.length > 0) yield data;
      }
    }
    buffer += decoder.decode();
    if (buffer.startsWith('data:')) {
      const data = buffer.slice(5).trim();
      if (data.length > 0) yield data;
    }
  } finally {
    reader.releaseLock?.();
  }
}

class WeNeedNativeAdapter {
  constructor(config, services = {}) {
    this.config = config;
    this.resolveKey = services.resolveKey;
    this.provider = config.provider || 'weneed-native';
    this.models = Array.isArray(config.models) ? config.models : [];
    this.modelMap = new Map(this.models.map((model) => [String(model.id), model]));
    this.interceptModels = Array.isArray(config.interceptModels) ? config.interceptModels : [];
    this.interceptMap = new Map(this.interceptModels.map((model) => [`${model.provider}/${model.id}`, model]));
  }

  configFor(provider, model) {
    const route = this.interceptMap.get(`${provider}/${model}`);
    if (route !== undefined) return route;
    if (provider === this.provider) return this.modelMap.get(String(model));
    return undefined;
  }

  providerInfo(provider) {
    return { id: provider, name: this.config.displayName || provider };
  }

  providerRetryPolicy() {
    return undefined;
  }

  async listModels(provider) {
    return this.models.map((model) => ({
      provider,
      id: String(model.id),
      name: String(model.name || model.id),
      inputModalities: ['text'],
    }));
  }

  async resolveModel(provider, model) {
    const config = this.modelMap.get(String(model)) ?? {};
    const efforts = Array.isArray(this.config.reasoningEfforts)
      ? this.config.reasoningEfforts
      : [
        { id: 'off', name: 'Off' },
        { id: 'low', name: 'Low' },
        { id: 'medium', name: 'Medium' },
        { id: 'high', name: 'High' },
        { id: 'max', name: 'Max' },
      ];
    return {
      provider,
      id: String(model),
      name: String(config.name || model),
      inputModalities: ['text'],
      context: { contextWindow: Number(config.contextWindow ?? 1000000) },
      ...(config.maxTokens === undefined ? {} : { defaultMaxTokens: Number(config.maxTokens) }),
      reasoning: {
        efforts,
        ...(this.config.defaultEffort === undefined ? {} : { defaultEffort: this.config.defaultEffort }),
      },
    };
  }

  async prepareCall(provider, model) {
    return {
      model: await this.resolveModel(provider, model),
      stream: (options) => this.stream(options),
    };
  }

  async *stream(options) {
    const modelConfig = this.configFor(options.provider, options.model) ?? {};
    const filtered = filterSkillCatalog(options.messages ?? []);
    const { messages, injected, reason } = injectSeed(filtered, options, modelConfig, this.config.targetRules);
    const wire = messages.map(wireMessage).filter(Boolean);
    const tools = Array.isArray(options.tools) ? options.tools : [];
    const body = {
      model: options.model,
      messages: wire,
      stream: true,
      ...(tools.length === 0 ? {} : {
        tools: tools.map((tool) => ({
          type: 'function',
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
          },
        })),
        tool_choice: this.config.toolChoice || 'auto',
        parallel_tool_calls: this.config.parallelToolCalls !== false,
      }),
      ...(options.maxTokens === undefined ? {} : { max_tokens: Number(options.maxTokens) }),
      ...(options.temperature === undefined ? {} : { temperature: Number(options.temperature) }),
      ...(options.reasoningEffort === undefined ? {} : { reasoning_effort: String(options.reasoningEffort) }),
      ...(modelConfig?.streamOptions === false || this.config.streamOptions === false
        ? {}
        : { stream_options: { include_usage: true } }),
    };

    const base = String(modelConfig?.baseURL || this.config.baseURL || 'http://127.0.0.1:8791/v1').replace(/\/+$/, '');
    const url = base.endsWith('/chat/completions') ? base : `${base}/chat/completions`;
    const envName = modelConfig?.apiKeyEnv ?? this.config.apiKeyEnv;
    let key = modelConfig?.apiKey;
    if (!key && envName !== undefined) {
      key = (await this.resolveKey?.(envName)) ?? process.env[envName];
    }
    if (!key && envName === undefined) key = this.config.apiKey;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'text/event-stream',
        ...(typeof key === 'string' && key.length > 0 ? { authorization: `Bearer ${key}` } : {}),
        ...(this.config.headers ?? {}),
      },
      body: JSON.stringify(body),
      signal: options.signal,
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`weneed-native upstream HTTP ${response.status}: ${detail.slice(0, 500)}`);
    }

    let text = '';
    let reasoning = '';
    let textIndex = -1;
    let reasoningIndex = -1;
    let nextToolIndex = 0;
    let textStarted = false;
    let reasoningStarted = false;
    const toolStates = new Map();
    let sawContent = false;
    let terminal = null;
    let usage;

    for await (const data of parseSseData(response)) {
      if (data === '[DONE]') break;
      let chunk;
      try {
        chunk = JSON.parse(data);
      } catch {
        continue;
      }
      if (chunk?.usage) usage = chunk.usage;
      const choice = Array.isArray(chunk?.choices) ? chunk.choices[0] : undefined;
      const delta = choice?.delta ?? {};
      const content = typeof delta.content === 'string' ? delta.content : '';
      const detailThinking = Array.isArray(delta.reasoning_details)
        ? delta.reasoning_details.map((detail) => detail?.text || detail?.summary || '').join('')
        : '';
      const thinking = typeof delta.reasoning_content === 'string'
        ? delta.reasoning_content
        : (typeof delta.reasoning === 'string'
          ? delta.reasoning
          : (typeof chunk?.reasoning_content === 'string' ? chunk.reasoning_content : detailThinking));
      if (content.length > 0) {
        if (!textStarted) {
          textIndex = nextToolIndex++;
          textStarted = true;
          yield { type: 'block-start', index: textIndex, blockType: 'text' };
        }
        text += content;
        sawContent = true;
        yield { type: 'text-delta', index: textIndex, text: content };
      }
      if (thinking.length > 0) {
        if (!reasoningStarted) {
          reasoningIndex = nextToolIndex++;
          reasoningStarted = true;
          yield { type: 'block-start', index: reasoningIndex, blockType: 'reasoning' };
        }
        reasoning += thinking;
        sawContent = true;
        yield { type: 'reasoning-delta', index: reasoningIndex, text: thinking };
      }
      const calls = Array.isArray(delta.tool_calls) ? delta.tool_calls : [];
      for (const call of calls) {
        const key = Number.isSafeInteger(call?.index) ? call.index : toolStates.size;
        let state = toolStates.get(key);
        if (state === undefined) {
          state = {
            index: nextToolIndex++,
            id: String(call?.id ?? ''),
            name: String(call?.function?.name ?? ''),
            arguments: '',
            started: false,
          };
          toolStates.set(key, state);
        }
        if (typeof call?.id === 'string' && call.id.length > 0) state.id = call.id;
        if (typeof call?.function?.name === 'string' && call.function.name.length > 0) state.name = call.function.name;
        const argumentsDelta = typeof call?.function?.arguments === 'string' ? call.function.arguments : '';
        state.arguments += argumentsDelta;
        if (!state.started) {
          state.started = true;
          yield { type: 'block-start', index: state.index, blockType: 'tool-call' };
        }
        sawContent = true;
        yield {
          type: 'tool-call-delta',
          index: state.index,
          id: state.id,
          ...(state.name.length > 0 ? { name: state.name } : {}),
          argumentsDelta,
        };
      }
      if (typeof choice?.finish_reason === 'string') terminal = choice.finish_reason;
    }

    if (textStarted) yield { type: 'block-end', index: textIndex, block: { type: 'text', text } };
    if (reasoningStarted) yield { type: 'block-end', index: reasoningIndex, block: { type: 'reasoning', text: reasoning } };
    for (const state of toolStates.values()) {
      yield {
        type: 'block-end',
        index: state.index,
        block: {
          type: 'tool-call',
          id: state.id,
          name: state.name,
          arguments: state.arguments.length > 0 ? state.arguments : '{}',
        },
      };
    }
    const mappedUsage = mapUsage(usage);
    if (mappedUsage !== undefined) yield { type: 'usage', usage: mappedUsage };
    yield { type: 'finish', reason: finishReason(terminal, sawContent) };
  }

}

export const name = 'dsh-weneed-plugin';
export const inject = ['llm'];
export { injectSeed, isCompactionRequest, isTarget, DEFAULT_TARGET_RULES, WeNeedNativeAdapter };

export function apply(ctx, config = {}) {
  const adapter = new WeNeedNativeAdapter(config, {
    resolveKey: async (ref) => {
      try {
        const credentials = ctx.get?.('credentials');
        const hit = await credentials?.resolve?.(ref);
        if (typeof hit?.value === 'string') return hit.value;
      } catch {
        // fall through to the launch environment
      }
      return process.env[ref];
    },
  });
  if (typeof config.provider === 'string' && config.provider.length > 0) {
    ctx.llm.registerAdapter([adapter.provider], adapter);
  }
  if (config.intercept !== false) {
    ctx.on('llm/stream', async function* (options, next) {
      if (options.provider === adapter.provider || options.purpose !== undefined) {
        yield* next();
        return;
      }
      const modelConfig = adapter.configFor(options.provider, options.model);
      if (modelConfig !== undefined && isTarget(options.model, modelConfig.name, modelConfig.target, config.targetRules)) {
        yield* adapter.stream(options);
        return;
      }
      yield* next();
    }, { global: true });
  }
}
