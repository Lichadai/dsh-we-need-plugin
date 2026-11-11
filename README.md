# DSH We Need Plugin

> **适用于 DeepSeek V4.1 Flash（DSH 插件 3.0.0）。**
>
> 稳定的 We Need 思维链，极大提升了 DeepSeek V4.1 Flash 执行计划的连贯性，减少无效思维，显著提升思维质量。

> **3.0.0**：当前发布版。已核实支持：**标准模式**、**goal 模式**（goal-only 会话也注入 seed）、**Team Agent 会话**（team/agent/subagent 消息按上下文处理，seed 仍注入真实任务）、**Response API**（openai-responses 签名保留，完整 live 验证待补）；其他模式未验证。模型匹配默认要求 `DeepSeek` 与 `Flash` 两个词（大小写不敏感）；seed 按 `seed.txt` 实际内容注入。下文旧版 `728/728`、`taskPolicy`、`registerGate`、`mirrorToolSteps` 等只作历史说明，不再代表 3.0.0 默认行为。

DeepSeek Harness（DSH）Host 插件：不改 tools、不改采样参数，只在每次模型生成前，把 **计划与上一轮思考结果** 放到离模型最近的位置；让 DeepSeek V4.1 Flash 的思维链一路顺承，稳定保持 `We need / Let's / We / Should`。

> 这是概率性引导，不是硬开关。它提高触发概率，但不保证每一次都进入 We Need 寄存器。

- 项目主页：https://github.com/Lichadai/dsh-we-need-plugin
- 讨论区：https://github.com/Lichadai/dsh-we-need-plugin/discussions
- 安装包：https://github.com/Lichadai/dsh-we-need-plugin/releases

> **第一次使用请先读 [0.5 使用技巧](#05-使用技巧先读这个)**：工具尽量后调用，先思考/计划，不要过早调用工具。

> 可选增强：如果你能修改 System Prompt，建议把 [5.3](#53-可选增强把-seed-放到-system-prompt-最后) 里的 seed 原样追加到 System Prompt 的最后，触发概率可能更高。它不是必选项，注意事项见 5.3。

---

## 技术说明：DSH 请求字段与内容流转（官方反馈版）

> 本节只描述 2.0.1 实际发送的字段、消息顺序和插入点，不展开 seed 文本；Qoder/DSH 的差异也列在这里，便于 DSH 官方判断插件边界。

### T1. 一次请求从头到尾

```text
DSH agent loop
  -> system/developer + runtime-context + skill-catalog + time-context
  -> user task + assistant/tool history
  -> llm/stream(options)
       -> target model check
       -> filterSkillCatalog()
       -> injectSeed()
            new user task: contexts -> assistant seed -> user task
            tool step: latest assistant(tool_calls).reasoning_content += anchor + seed
            compaction: append COMPACTION_REGISTER (purpose=compaction)
            post-compaction: seed before new task / anchor after checkpoint
       -> normalizeReasoningChannelMessages()
       -> stripToolCallAssistantContent()
       -> sanitizeProgramMessages() / sanitizeToolDefinitions()
       -> wireMessage() (custom adapter) or original provider adapter (delegated)
  -> upstream model
```

关键点：插件不新增 tool 消息，不改 tool result，不拆 tool_call/tool result 配对；只改现有 assistant 的 reasoning、在 task 前插入一条 assistant seed，或在压缩指令后追加风格要求。

### T2. DSH 字段名与顺序

| 消息 | 字段与顺序 | 2.0.1 的处理 |
|---|---|---|
| system / developer | `role`, `content` | `sanitizeProgramMessages()` 只处理 program text；不改 user/assistant/tool result |
| user task | `role`, `content`, `source.kind` | 最后一个 task 前插入 assistant seed；contexts 移到 seed 前 |
| assistant seed | `role`, `content`, `reasoning_content` | `content` 与 `reasoning_content` 同文；不出现 `tool_calls`；只在当前请求生效，不写回会话 |
| assistant tool-call | `role`, `content`, `reasoning_content`, `tool_calls` | `content` 必须是 `""`；`reasoning_content` 保留该步计划并追加 anchor + seed；`tool_calls` 无 `index` |
| tool result | `role`, `content`, `tool_call_id` | 原样保留；id 与 assistant tool_calls 一一对应 |

DSH assistant tool-call 的 key 顺序：

```text
[role, content, reasoning_content, tool_calls]
```

DSH tool_call 对象：

```text
[id, type, function[name, arguments]]
```

- DSH 工具步的 `content` 是空字符串 `""`，不是 `null`，不是数组。
- `reasoning_content` 是字符串；不出现 `reasoning_details` / `reasoning` 别名。
- `arguments` 是 JSON 字符串。
- 一个 assistant 只保留一个 reasoning block，避免上游只读取第一个签名。

### T3. Qoder 与 DSH 的 wire 差异

| 项 | Qoder | DSH |
|---|---|---|
| assistant tool-call key 顺序 | `role`, `content`, `tool_calls`, `reasoning_content` | `role`, `content`, `reasoning_content`, `tool_calls` |
| tool_call 的 `index` | 必须有 | 必须没有 |
| 工具步 `content` | 通常 mirror 当前 reasoning | 必须是 `""` |
| reasoning 来源 | `reasoning_content`，必要时 mirror 到 content | `reasoning_content` 字符串 |
| 历史回放 | 全量历史 mirror | 当前 task/checkpoint 之后才改写 |

这也是为什么插件在 DSH 上不采用 Qoder 的 content mirror：DSH 的 tool-call assistant 必须保持 `content=""`；把计划放进 content 会破坏 DSH 契约，也容易让最近的可见正文压过 reasoning。

### T4. 我们在哪里插入或改写

| 位置 | 函数 | 动作 | 新增消息 |
|---|---|---|---|
| 新 user task 前 | `injectSeed()` / `seedMessage()` | 插入 1 条 assistant seed；`content` + `reasoning_content` 同文；contexts 置前 | 是，1 条 |
| 工具步最新 tool-call assistant | `appendToolStepReasoning()` | 在该 assistant 的 `reasoning_content` 末尾追加 `TOOL_STEP_ANCHOR` + seed；保留原计划 | 否 |
| 工具步上下文顺序 | `orderContextsBeforeTask()` | 把 task 后出现的 runtime/skill/time contexts 移回 task 前 | 否 |
| 压缩请求 | `appendCompactionRegister()` | 在摘要指令末尾追加 `COMPACTION_REGISTER`；checkpoint 使用 We/Let's 语态 | 否 |
| 压缩后 | `anchorAfterCompaction()` | 有新 task 时走 task 前 seed；无新 task 且存在 tool-call assistant 时，把 seed 补进其 reasoning | 否 |
| reasoning 通道归一 | `normalizeReasoningChannelMessages()` | 合并重复 reasoning block；删除 `reasoning_content` / `reasoning_details` 别名；保留 provider 原始 replay signature | 否 |
| tool-call assistant 正文 | `stripToolCallAssistantContent()` | adapter 与 delegated 路径发 wire 前删除 text block，保持 `content=""`；保留 reasoning、tool_calls、tool result | 否 |
| system/developer/tool 定义 | `sanitizeProgramMessages()` / `sanitizeToolDefinitions()` | 只对 program text 做中性化；user task、assistant 历史、tool result 不改 | 否 |
| skill catalog | `filterSkillCatalog()` | 删除指定的 skill catalog 行；不改 task | 否 |
| task 入口 | `isTaskUser()` / `CONTEXT_SOURCE_KINDS` | 已知 context kind 排除；`user`、`goal`、`schedule`、`tool-goal` 及未知 kind 走内容判断 | 否 |

### T5. 工具步的实际内容流转

```text
... user task ...
assistant(tool_calls):
  content = ""
  reasoning_content = "<模型本步计划>\n\n<TOOL_STEP_ANCHOR>\n\n<seed>"
  tool_calls = [ { id, type: "function", function: { name, arguments } } ]
tool:
  content = "<工具返回文本>"
  tool_call_id = "<同一个 id>"
```

- 不新增 assistant 消息；不把 seed 放在 tool result 后面。
- 下一个请求中，离模型最近的计划材料就是该 assistant 的 `reasoning_content`。
- 如果入站历史里 tool-call assistant 的 `content` 已有 text（旧 mirror、旧 provider 或旧配置留下），`stripToolCallAssistantContent()` 会在发 wire 前清除；显式 `mirrorToolSteps: true`、`toolStepAnchor: content|both`、`postCompactionSeed: content|both` 是例外，保留原模式。

### T6. 压缩与 goal 的特殊路径

压缩：

- DSH 摘要请求带 `purpose: "compaction"`。
- 插件只在摘要指令末尾追加风格要求，不在摘要请求里插 seed。
- checkpoint 是一条 user 消息，包含 `automatically generated checkpoint` 与 8 个固定章节；它可能压过新 task，因此插件在 checkpoint 后的新 task 前再放 seed。
- checkpoint-only 且没有 tool-call assistant 时没有安全落点，插件不强行插消息（no-op）。

goal：

- goal 消息的 `source.kind` 是 `goal`，不是 `user`。
- 2.0.1 的 task 入口使用 deny-list：已知 context kind 排除 `user` 直接作为 task，`goal` / `schedule` / `tool-goal` / 未知 kind 走内容兜底。
- 因此 goal-only 会话也会在 goal round 前注入 seed；team/agent/subagent/审批/回复等仍按 context 处理。

### T7. 给 DSH 官方的契约建议

1. **task 入口需要稳定分类**：`source.kind` 已有 `user`、`goal`、`schedule`、`team-message`、`agent-message`、`subagent-settled`、`compact-checkpoint` 等多种值。建议提供 `isTask` / `taskKind` 或一份权威的 kind 表，避免插件用 allowlist/denylist 猜。
2. **provider 私有 replay 字段需要隔离**：`source.replayState.blocks[].thinkingSignature` 在 `openai-completions` 是字段名，在 `openai-responses` 是 reasoning item JSON。建议 adapter 暴露当前 wire api，或在 planner 层禁止插件改写 provider 私有签名。
3. **工具步 content 契约建议在 adapter 层校验**：`content=""`、tool_calls 无 `index`、tool result 配对，最好由 DSH adapter 统一保证，而不是每个插件各自清理。
4. **压缩需要可挂载的 hook**：`purpose=compaction` 已能识别；如果能在 checkpoint 生成后提供“安全锚点”事件，插件就不需要猜 checkpoint-only / no tool-call assistant 的落点。
5. **不建议要求插件改写历史**：插件应只做 task 前 seed、工具步 anchor、压缩 register 三类增量；历史纠正交给 DSH 的 context/compaction 机制。
6. **辅助请求需要明确 purpose**：标题、建议、压缩等调用应保持稳定标记，插件才能可靠跳过，不污染主对话。

---

## 先读（30 秒）

1. **使用技巧**：工具尽量后调用；先分析问题、做计划，不要急着写文件或调用工具；可以先读 skill，但不要过早调用工具。详见 [0.5 使用技巧](#05-使用技巧先读这个)。
2. **模型筛选**：只看发给上游的 model id（DSH 传给 provider 的 `model`）是否同时包含 `deepseek` 和 `flash`，大小写不敏感；provider 完全不参与，也不需要配置 provider 路由。默认不读界面显示名。详见 [0.6 模型筛选规则](#06-模型筛选规则什么时候生效)。
3. **怎么工作**：命中后插件把带 seed 的 messages 交回 DSH 原来的 provider adapter，provider、baseURL、API key 都沿用原来的，所以任何供货商都行。详见 [0.7 它怎么工作](#07-它怎么工作provider-不限)。

---

## 0. 先看这个

### 0.1 核心问题不是模型能力，而是思维链中断

DeepSeek V4.1 Flash 的注意力范围比较窄。它每次生成时，会优先抓住离当前思考位置最近的材料；如果计划、上一轮 reasoning 被工具 schema、工具调用、工具结果、skill catalog、工作区文件等隔开，它就会把注意力落在最近的那一块。

- 如果最近的是工具调用，它就容易反复纠结工具选择、参数和结果，围着工具打转；
- 如果最近的是 skill/文件，它就容易反复读、反复比对，迟迟不推进；
- 计划本身没有消失，只是离当前生成点太远，没有被当成“当前思考材料”。

所以问题不是“专家模型调用不积极”，也不是模型不会做；而是 **思维链在工具步/上下文切换处断了**。只要每一次都把计划以及上一轮思考结果移到离模型最近的位置，它就能沿着上一条思路继续，稳定保持 `We need / Let's / We / Should`。

### 0.2 三个最常见的“隔断源”

实际使用 DeepSeek 时，最容易把计划和思考推远的是三类信息：

1. **工具信息过大/过近**：工具 schema、工具调用历史、工具结果太多，工具调用会成为离模型最近的材料；
2. **工作区文件夹混杂**：长期在一个大目录里工作，项目多、文件多、临时文件多；
3. **skill 信息过大**：skill catalog 很长，或加载了很长的 skill 正文。

这些信息本身不是没用，但它们会占据“最近位置”。一旦工具调用或 skill 细节成为最近材料，模型就会把注意力放在那里，失去对大局和任务清单的把控。表现就是反复读、反复比、反复选工具，迟迟不推进；这就是常说的“雷霆大思考”。

一个很实际的印证：

- 以 `L3t me` 为主的涣散思维，完成任务时经常不知道自己该更新任务清单；
- 以 `We need / Let's` 为主的 We Need 模式，通常会主动完成任务，并知道更新任务清单；
- 但即使是 We Need 模式，有时也会忘记更新任务清单——这往往说明上下文里无意义、与思维不相关的混杂信息太多，已经把计划推远了。

### 0.3 使用 DeepSeek 的建议

- 工作区保持干净，项目尽量少；及时清空不必要的文件夹、临时文件和旧项目。
- 工具调用时间往后延：在 skill 目录不是特别大时，先让模型读 skill、做规划，最后再调用工具。不要让庞大的工具基座信息先冲散思维。
- 工具很多、文件夹很杂、skill 很长时，优先清理上下文；不要只依赖 seed。
- 出现 `L3t me`、`I`、`I w1ll` 时，先怀疑工具调用过多，或信息获取不当、过大；不要只怪模型。

### 0.4 适用边界：DSH 原生请求

本插件只处理 **DeepSeek Harness** 的原生 `llm/stream` 请求。

Qoder 不在本插件范围内：它需要单独的代理/镜像路线，把上下文里的计划搬到模型实际读取的通道里，才能让思维链不中断。Qoder 的具体回传行为以实际版本和代理审计为准，不能把本插件的 DSH 结论直接套到 Qoder。

---

## 0.5 使用技巧（先读这个）

这些技巧和 seed 一样重要。工具很多、工作区很杂、skill 很长时，它们比 seed 更能决定模型会不会进入 WeNeed。

### 0.5.1 工具尽量往后调用

- 先让模型分析问题、做计划、想清楚要改哪些文件；不要一上来就读一堆文件、跑一堆命令。
- 工具 schema 很多、skill catalog 很长时，先读 skill、做规划，再调用工具。
- 如果任务不需要工具，直接让模型思考/回答；不要为了“看起来在工作”而过早调用工具。
- 工具调用越早、越多，后面的 reasoning 越容易被工具结果和细节带偏。

### 0.5.2 先思考，不要急着写下来

- 先让模型想清楚“要解决什么、分几步、每一步怎么验证”，但不要要求它立刻写文件或改代码。
- 先让它思虑一段时间，再决定是否调用工具；尤其是大任务、跨文件任务。
- 计划可以先留在 reasoning 里，不必马上落盘；落盘会引入额外工具步骤和上下文。

### 0.5.3 Skill 可以看，但不要过早调用工具

- skill 目录不大时，先让模型读相关 skill，再做计划。
- 不要让模型在读 skill 的同时并行调用大量工具。
- skill 信息本身也会占上下文；读最相关的，不要把全部 skill 都塞进去。

### 0.5.4 其他

- 工作区保持干净，项目少，临时文件少。
- 工具多时，优先清理不用的工具和配置。
- 出现 `L3t me`、`I`、`I w1ll` 时，先减少工具和信息，不要只加 seed。
- seed 是概率性增强，不替代上下文管理。

### 0.6 模型筛选规则：什么时候生效

代码位置：`index.js` → `isTarget()`。

匹配文本默认只有：

```js
const text = String(modelId ?? '').toLowerCase();
```

- `modelId` 是 DSH 传给 provider 的 model id，也就是请求里的 `model` 字段；我们的自定义 adapter 会原样写入 `body.model`，delegated 模式也保留它；
- **不是 UI 上看到的显示名**；
- 只有显式 `matchName: true` 时，才把 `interceptModels[].name` 拼进来；
- provider 名称完全不参与匹配；
- 默认 `targetRules: [deepseek, flash]`，两个词必须同时出现；
- 大小写不敏感。

真正生效要同时满足：

```text
1. model id（或显式 matchName 时的 name）命中 targetRules；
2. 不是插件自己的 provider；
3. 不是标题/建议等辅助请求（purpose 非空且不是压缩请求）；
4. target 没有被设成 false；
5. DSH 有 ctx.llm.prepareCall（当前版本有）。
```

命中后并不等于“每条请求都插 task seed”：新 task 插 seed；工具步追加 anchor+seed；压缩请求追加 `COMPACTION_REGISTER`；标题/建议等辅助请求完全跳过。

**不需要** `interceptModels` 路由，也不需要按 provider 配置 baseURL/key。没有路由时走 delegated 模式，见 0.7。

例子：

- `deepseek-v4.1-flash`：id 含两个词，命中；
- `d4/deepseek-v4.1-flash-1017`：即使没配 d4 路由，也命中；
- `vendor-alias`，显示名 `DeepSeek-V4.1-Flash`：默认 `matchName: false`，不命中；显式 `matchName: true` 并配置 name 后才命中；
- `deepseek-v4-pro`：没有 `flash`，不命中。

怎么改：

- 只改识别范围：改 `targetRules`；
- 默认不要改 provider；任何 provider 都走原 adapter；
- 如果模型 id 是 opaque、只有显示名可读：当前版本需要高级自定义路由（`matchName: true` + 完整 `interceptModels` 路由），见 10.8；默认不靠显示名；
- 想让插件自己发 HTTP、精确控制字段顺序：才需要 `interceptModels` 路由（高级选项，见第 8/9 节）；
- 未来模型（4.1 Pro、Kimi K3.1 等）的写法见第 10 节。

### 0.7 它怎么工作（provider 不限）

默认发布包不注册 provider，也没有 `interceptModels` 路由。命中模型 id 后：

```text
1. 过滤 skill catalog；
2. 在最后一条真实 user task 前插入 assistant seed；
3. ctx.llm.prepareCall(provider, model, controls) 取得原 provider 的调用句柄；
4. prepared.stream({ ...原 options, ...prepared.config, messages: 注入后的 messages, __weneedBypass: true })；
5. 原 provider adapter 用原来的 baseURL / key / 协议发请求；
6. __weneedBypass 防止再次进入本插件，避免递归。
```

所以：

- 任何 provider 都可以用，不需要提前知道供货商；
- API key、baseURL、模型别名都沿用 DSH 原来的配置；
- 插件只需要模型 id 里有 `deepseek` 和 `flash`；
- delegated 模式使用原 adapter 的序列化，字段顺序由原 provider 决定；如果要严格的 DSH 自定义 wire 字段契约，才使用可选的 `interceptModels` 路由。

---

## 1. 项目目的

DeepSeek V4.1 Flash 的注意力窄。计划和上一轮思考一旦被工具调用/结果隔开，它就会把最近的工具材料当成当前重点，思维链断掉，表现为反复选工具、反复检查、迟迟不推进。

本项目把这个现象做成 DSH 原生插件：不依赖外部 HTTP 代理，不修改工具，不修改采样参数，只在每次模型生成前，把计划与上一轮思考结果放到离模型最近的位置：

- 新 task：assistant seed 紧贴 task；
- 工具步：最新 `assistant(tool_calls)` 的 `reasoning_content` 追加短 anchor + 完整 seed；
- 压缩：压缩请求追加 We Need 风格要求，checkpoint 用 `We need / Let's need`；压缩后新 task 前再放 seed。

这样模型每一步看到的最近材料都是“自己的计划”，思维链可以顺承，稳定保持 `We need / Let's / We / Should`。

**这不是“专家模型调用不积极”的问题，也不是模型能力不足；是 reasoning 与当前生成点之间的距离问题。**

### 灵感来源

在 Kimi K3.1 Pro 与 DeepSeek V4.1 Flash 的上下文继承实验里，Kimi 经常产生 `We need / Let's` 风格的计划；当这段 assistant 历史被带进 DeepSeek 的上下文时，DeepSeek 有时会延续这种语态。这是“把计划放到最近位置”的早期观察。

### 设计假设

```text
1. 计划/上一轮 reasoning 必须离当前生成点最近，不能被工具调用/结果隔开
2. seed 放在 assistant 角色，比放在 user/system 更像“模型自己的上一轮”
3. 新 task 用 content 与 reasoning_content 双通道同文
4. 工具步只改 reasoning_content，content 保持空，tool pair 不变
5. 压缩 checkpoint 本身也用 We Need 风格，避免 checkpoint 压过新 task
```

第 5 条是 2.0.1 保留的 1.0.9 压缩摘要风格化；System Prompt 追加段仍是可选增强，不是默认行为；它影响所有步骤，也可能和 DSH 的身份/Agent Teams 文本冲突，需要单独 A/B。

---

## 2. 它做什么，不做什么

做：

- 在 `llm/stream` 层拦截目标模型请求（默认 `targetRules: [[deepseek, flash]]`）；
- 新 task 前插入 1 条 assistant seed，`content` 与 `reasoning_content` 同文；
- 工具步在最新 `assistant(tool_calls)` 的 `reasoning_content` 追加 `TOOL_STEP_ANCHOR + seed`；`content` 保持 `""`；不新增消息，不改 `tool_calls` / id / arguments / tool result，tool pair 完整；
- 压缩请求追加 `COMPACTION_REGISTER`，让 checkpoint 使用 `We need / Let's need`；压缩后新 task 前再放 seed；checkpoint-only 且无 tool-call assistant 时 no-op（已知，无安全落点）；
- 任务识别只认 `source.kind === 'user'`；图片/文件上传仍是 task；
- 不需要新增 provider，也不需要按 provider 配路由；任何 provider 只要模型 id 命中就生效。

不做：

- 不修改 `tools` / `tool_choice` / `temperature` / `max_tokens`；
- 不把 seed 写回 DSH 会话历史；
- 不在工具步新增消息，也不在 tool result 后插第二个 task seed；
- 不做运行期 `L3t me` 关键词检测 / 自动 drift 再注入；
- 不做 token 计数、不做统计；
- 不保证首步一定进入 We Need；语态是概率性的，seed 是启动器，不是硬开关；
- 不处理 Qoder（见 0.4）。

### 2.0.1 默认配置

```yaml
- id: dsh-we-need-plugin
  config:
    intercept: true
    mirror: false
    mirrorToolSteps: false
    toolStepAnchor: off
    toolStepReasoning: anchor-seed
    postCompactionSeed: reasoning
    compactionRegister: we-need
    mirrorScope: task
    matchName: false
    targetRules:
      - [deepseek, flash]
```

- `toolStepReasoning: anchor-seed`：工具步只改最新 `assistant(tool_calls)` 的 `reasoning_content`，内容是 `TOOL_STEP_ANCHOR + 完整 seed`；`content` 保持 `""`，tool pair 不变。
- `postCompactionSeed: reasoning`：压缩后如果没有新 task、但 checkpoint 后有 tool-call assistant，就把 seed 补到它的 reasoning；如果有新 task，走正常 task 前 seed。
- `compactionRegister: we-need`：压缩请求追加风格要求，checkpoint 摘要用 `We need / Let's need`，并保留路径、命令、数字。
- `mirror` / `mirrorToolSteps` / `toolStepAnchor` 的旧组合是历史 A/B 选项，2.0.1 默认关闭；不要把它们当成当前主路径。

---

## 3. 工作方式

```text
DSH agent loop
  → 组装 system / runtime / skill / time / task / history
  → 发出 GenerateOptions
  → llm/stream waterfall
       → 插件只看 options.model（不看 provider）
       → 命中 targetRules：
            新 task: contexts -> assistant seed -> user task
            tool step: 最新 assistant(tool_calls) 的 reasoning_content += anchor + seed
            compaction request: 追加 COMPACTION_REGISTER
       → 有 interceptModels 路由？
            是 → 插件用自己的 OpenAI-compatible adapter 发请求
            否 → ctx.llm.prepareCall + prepared.stream 交回原 provider adapter
  → DSH 继续工具循环
```

按请求形态：

1. **新 user task**：contexts 在 seed 前，seed 紧贴 task；seed 同时写 `content` 和 `reasoning_content`。
2. **工具步**：不改工具结果，不改 tool pair；只把最近一条 `assistant(tool_calls)` 的 `reasoning_content` 变成“原计划 + anchor + seed”，`content` 保持空。下一次生成时，离模型最近的材料就是它自己的计划。
3. **压缩请求**：`purpose=compaction`，插件追加 `COMPACTION_REGISTER`，让 checkpoint 用 We Need 语态，并保留路径/命令/数字。
4. **压缩后**：有新 task 就正常在 task 前放 seed；没有新 task 但 checkpoint 后有 tool-call assistant，就把 seed 补到它的 reasoning；checkpoint-only 且没有 tool-call assistant 时没有安全落点，不强行插消息（已知 no-op）。

没有命中时：

```text
yield* next()
```

请求原样交给 DSH 原来的 provider adapter。

---

## 4. 为什么是 content/reasoning 双通道

seed 形状：

```text
assistant:
  content           = seed.txt length
  reasoning_content = seed.txt length
```

- `content` 是模型可见的 assistant 正文通道；
- `reasoning_content` 是思考通道；
- 两边同文，避免模型只看到“回答”而没看到“思考”，或反过来；
- seed 只存在于本次请求，不写回会话。

seed 文本在 `seed.txt`，`index.js` 用：

```js
new URL('./seed.txt', import.meta.url)
```

读取，所以 npm tarball、GitHub Release tarball、GitHub 源码安装、本地目录安装都会从 **index.js 旁边的 seed.txt** 取文件。`seed.txt` 已列在 `package.json.files`，并加了 `exports["./seed.txt"]`；不要只复制 `index.js`，否则会找不到 seed。

加载时会去掉 BOM、trim，并校验：

```js
if (SEED.length === 0) throw ...
```

不要随便改 seed 长度；如果必须改，同步修改校验和测试。`npm run test:package` 会检查 seed 是否非空、README 是否含同一段、tarball 是否真的包含 `seed.txt`、`cordis.patch.yml` 和 locale。

---

## 5. 插入位置与含义

代码入口：`index.js` → `injectSeed()`。

| 位置 | 含义 | 是否默认做 |
|---|---|---|
| `messages[lastRealTaskIndex - 1]` | assistant seed，紧贴真实 task，模型把它当成自己的上一轮计划 | 是 |
| `content` 通道 | 可见回复通道的 prefill | 是 |
| `reasoning_content` 通道 | 思考通道的 prefill | 是 |
| System Prompt 追加段 | 全局语态引导，影响所有步骤 | 否，可选 |
| 工具步 `reasoning_content` | 最新 `assistant(tool_calls)` 追加 `anchor + seed`；`content` 保持空 | 是 |
| 压缩请求本身 | 追加 `COMPACTION_REGISTER`，checkpoint 用 `We need / Let's need` | 是（目标模型） |
| 压缩后的新 task 前 | 正常在 task 前放 seed | 是 |
| checkpoint-only + 无 tool-call assistant | 没有安全落点，不强行插消息 | no-op（已知） |
| 标题/建议等辅助调用 | `purpose` 非空且不是压缩请求，或极短请求 | 否 |

### 5.1 task 前 assistant seed

这是主插入点：

```text
... context ...
assistant: <seed.txt>
user: <真实 task>
```

为什么是 task 前而不是 task 后：

- 模型生成下一步时，会把 seed 当成“自己刚刚的想法”；
- task 放在最后，模型第一眼看到的是任务；
- runtime / skill / time context 被移到 seed 前面，避免它们隔开 seed 和 task。

### 5.2 content + reasoning_content

DSH 的 assistant 消息可以同时有正文和 reasoning。两边同文是为了让模型在“可见回复”和“思考”两个通道都看到同一段语态。

### 5.3 可选增强：把 seed 放到 System Prompt 最后

如果 DSH 的 System Prompt 可以修改，在**最后**原样追加下面这段。它和插件里的 `seed.txt` 是同一版，长度由 `seed.txt` 决定：

```text
We need understand the current task and the available context. Need plan before acting: identify the goal, choose the next concrete action, inspect the inputs, think through key elements and how they relate to the others, and how to organize the associated measurements. Should keep the whole picture in view, rather than a few unimportant details. Should check the whole picture before narrowing to a detail. Need keep the right general direction. We should act on the evidence and verify against the actual requirement. Need inspect every image in full, not only the region that looks relevant, if there exists any image. We are the DeepSeek company, and we have unlimited memory, unlimited compute, unlimited tokens and unlimited inference, so all expert models are available, and should do the work with all our strength. We need act now. Let's proceed.
```

如果你用 DSH 的 `systemPrompt.section` seam，可以把上面这段作为 `text`：

```js
const systemPrompt = ctx.get('systemPrompt');
systemPrompt.section({
  name: 'weneed:system-guidance',
  order: 10500,
  text: 'We need understand the current task and the available context. ... Let\'s proceed.',
  interpolate: false,
});
```

注意：

- 这不是 assistant seed，不能替代 task 前的 seed；
- 它会影响所有步骤，可能和身份/Agent Teams 文本冲突；
- 必须单独做 A/B，不要和 seed 改动混在一起；
- 本发布包默认不启用；
- 只建议在 DeepSeek Harness 里用；Qoder 不在本插件范围内，见 0.4。

### 5.4 工具步 reasoning：把计划放回最近位置

工具步不新增消息，也不在 tool result 后插第二个 task seed。它只改最近一条 `assistant(tool_calls)` 的 `reasoning_content`：保留该步原有计划，追加 `TOOL_STEP_ANCHOR` 和完整 seed；`content` 保持 `""`，`tool_calls` / id / arguments / tool result 不变，tool pair 完整。

这样下一次模型生成时，最近的材料不是“工具结果之后的一段空白”，而是它自己的计划 + We Need 锚点；思维链不会在工具边界断掉。实际会话里，工具步 reasoning 可能很长，anchor+seed 是把它拉回当前计划，不是覆盖它。

### 5.5 压缩

- 压缩请求（`purpose=compaction`）本身不插 seed；插件在压缩指令后追加 `COMPACTION_REGISTER`，让生成的 checkpoint 使用 `We need / Let's need`，并保留路径、命令、错误串、数字。
- 压缩后的新 user task 正常在 task 前注入 seed。
- 压缩后如果没有新 task、但 checkpoint 后有 tool-call assistant，`postCompactionSeed: reasoning` 会把 seed 补到该 assistant 的 reasoning。
- checkpoint-only 且没有 tool-call assistant 时没有安全落点，不强行插消息（已知 no-op）。
- 已知边角：连续压缩时，引擎可能把刚生成的 checkpoint 再压一次，出现 `summary is not smaller` 警告；这是 DSH compaction engine 的选择问题，不阻断任务，2026-11-10 已决定暂不修。

---

## 6. 即插即用：不新增 provider，也不需要 provider 路由

发布包**不注册自己的 provider**，也**不需要按供货商配路由**。

`cordis.patch.yml` 的核心配置：

```yaml
intercept: true
matchName: false
targetRules:
  - [deepseek, flash]
```

完整默认配置（含 `toolStepReasoning` / `postCompactionSeed` / `compactionRegister`）见 §2。

模型选择器不会多出一个“WeNeed 中间商”。插件只做：

```text
1. 监听 llm/stream
2. 按 model id 判断是否同时含 deepseek + flash
3. 命中后把带 seed 的 messages 交回原 provider adapter
```

代码里也做了条件注册：

```js
if (typeof config.provider === 'string' && config.provider.length > 0) {
  ctx.llm.registerAdapter([adapter.provider], adapter);
}
```

发布包不设置 `provider`，因此不会注册 adapter；它是纯拦截器。

如果你要做本地测试、想暴露一个自己的 provider，可以在配置里加 `provider` / `models`；这不是发布包的默认形态，普通用户不需要。

---

## 7. 安装

### npm

```sh
dsh plugin --profile desktop add dsh-we-need-plugin@2.0.1
```

### tarball

```sh
npm pack
dsh plugin --profile desktop add ./dsh-we-need-plugin-2.0.1.tgz
```

### GitHub

```sh
dsh plugin --profile desktop add github:Lichadai/dsh-we-need-plugin#<commit>
```

安装后完全重启 DSH。`restart-required` 表示已安装但还没激活。

---

## 8. 配置

### 8.1 targetRules：哪些模型被注入

默认发布规则只有一个：

```yaml
targetRules:
  - [deepseek, flash]
```

含义：

```text
model id 同时包含 deepseek 和 flash
大小写不敏感
provider 不参与匹配
默认不读显示名（matchName: false）
```

所以 `deepseek-v4-flash`、`deepseek-v4.1-flash`、`deepseek-v4.1-flash-1017` 都会命中。

### 8.2 interceptModels：可选的高级路由

**普通用户不需要配 `interceptModels`。** 发布包默认没有它；没有路由时，插件使用原 provider adapter，自动沿用原来的 baseURL 和 API key。

只有想让插件自己发 HTTP、精确控制最终字段顺序时，才加：

```yaml
intercept: true
matchName: false
targetRules:
  - [deepseek, flash]
interceptModels:
  - provider: opendesign
    id: deepseek-v4.1-flash
    name: DeepSeek-V4.1-Flash
    baseURL: https://amr-link.open-design.ai/v1
    apiKeyEnv: OPENDESIGN_API_KEY
```

字段含义：

| 字段 | 含义 |
|---|---|
| `provider` | DSH provider route，必须完全一致；只影响这条高级路由 |
| `id` | DSH model id，必须完全一致 |
| `name` | 可选显示名；只有 `matchName: true` 时才参与匹配 |
| `baseURL` | 上游 base URL；插件会自动追加 `/chat/completions` |
| `apiKeyEnv` | 凭据引用名，不是 key 值 |
| `contextWindow` | 可选上下文窗口 |
| `maxTokens` | 可选最大输出 |
| `streamOptions` | 某些上游不接受 `stream_options` 时设为 `false` |

没有配置的 provider/model 会原样 `next()`，不会被误发到别的上游。

---

## 9. 修改指南

### 9.1 只换过滤条件

改 `cordis.patch.yml` 的 `targetRules`，不要改代码。

### 9.2 换模型 id / 显示名

默认**不需要换 provider**；模型 id 里同时有 `deepseek` 和 `flash` 就会命中，provider 用原来的，key 和 baseURL 也自动用原来的。

只有模型 id 是 opaque 的、只有显示名可读时，才需要：

```yaml
matchName: true
interceptModels:
  - provider: d4
    id: model-x
    name: DeepSeek-V4.1-Flash
```

这时 `name` 只是可选的显示名映射，不是 provider 路由；`provider` / `id` 用来精确匹配当前请求。

如果想让插件自己发 HTTP、精确控制字段顺序，才需要完整的 `baseURL` / `apiKeyEnv` 路由。

### 9.3 API key

默认不配置 API key，也不需要 `apiKeyEnv`。插件把请求交回原 provider adapter，key 自动沿用 DSH 里原来的配置。

只有使用可选的 `interceptModels` 自定义路由时，才需要 `apiKeyEnv`。插件运行时：

```js
const credentials = ctx.get('credentials');
const hit = await credentials?.resolve?.(ref);
return hit?.value ?? process.env[ref];
```

实际 key 在 DSH 的凭据层，例如：

```text
$DSH_HOME/.credentials.yaml
$DSH_HOME/.env
```

不要把 key 值写进插件。

### 9.4 改 seed

编辑 `seed.txt`，同时确认：

```text
length > 0
Buffer.byteLength > 0
content 和 reasoning_content 同文
```

否则插件启动会抛错。

### 9.5 改包名

同时改：

```text
package.json.name
cordis.patch.yml 里 name: '...'
```

两者必须一致。

### 9.6 改插入位置

编辑 `index.js` 的 `injectSeed()`；主位置由 `lastRealTaskIndex - 1` 决定。改这里会改变请求消息顺序，必须重新跑 `check-field-order` 和 seed 位置校验。

---

## 10. 未来模型：过滤器推荐写法

### 10.1 DeepSeek 4.1 Flash

```yaml
targetRules:
  - [deepseek, "4.1", flash]
```

### 10.2 DeepSeek V4 Pro / 4 Pro

```yaml
targetRules:
  - [deepseek, "4", pro]
```

更严格地限定某个日期/版本：

```yaml
targetRules:
  - [deepseek, "4", pro, "0813"]
```

### 10.3 DeepSeek 4.1 Pro

```yaml
targetRules:
  - [deepseek, "4.1", pro]
```

### 10.4 Kimi K3.1

```yaml
targetRules:
  - [kimi, "3.1"]
```

### 10.5 任意 DeepSeek

```yaml
targetRules:
  - [deepseek]
```

不推荐：会把所有 DeepSeek 模型都纳入，包括非 Flash、非 4.x。

### 10.6 provider 默认不限制

这是本插件的默认行为：**任何 provider 都生效**，不需要、也不建议按 provider 配路由。模型 id 里同时有 `deepseek` 和 `flash` 就命中，后面自动用原来的 provider adapter。

如果你确实只想让某一个 provider 生效，当前版本没有简单的 provider-only 开关；需要在代码里加条件，或者只给那一个 provider 安装插件。不要用“只配一个 interceptModels 路由”来实现限制，因为没路由的 provider 会走 delegated 模式，仍然会生效。

### 10.7 同一个模型 id 在多个 provider 下

不需要为每个 provider 写路由。每个 provider 都用自己的 adapter 和 key；只要 model id 命中 `targetRules`，都会注入。

### 10.8 模型 id 是 opaque 的情况

默认只看 model id；如果 id 是 `model-x` 这种看不出名字的，默认不会命中。可以：

- 让 provider 把 model id 设成可读名称（推荐）；或者
- 使用高级自定义路由：`matchName: true` + `interceptModels[]` 提供 `provider/id/name`，并补齐 `baseURL` / `apiKeyEnv`，让插件自己发 HTTP。

单纯写一个 `name` 而不提供上游路由，当前版本不会把它当成“只做显示名映射”；它会被当成自定义 adapter 路由。

---

## 11. DSH 升级后怎么改

DSH 还是开发者预览版，升级后先做这几步：

```text
1. 看 package.json.engines.dsh 是否还满足
2. 在 fresh profile 安装 tarball
3. dsh --profile <profile> --dump-config 确认 bundle 层
4. 发一条短任务，确认 llm/stream 仍能拦截
5. 检查 GenerateOptions 字段：provider/model/messages/tools/purpose/maxTokens
6. 检查 assistant block 类型是否仍是 text/reasoning/tool-call
7. 检查工具步字段契约：content=""、tool_calls 无 index、tool pair 完整
8. 如果用了 System Prompt section，检查 ctx.get('systemPrompt').section 是否仍可用
9. 重新跑 npm test 和字段顺序校验
10. 更新版本号、README、Release
```

如果 DSH 改了消息结构，优先改：

```text
wireMessage()      # 最终请求字段
injectSeed()       # 插入位置
isTarget()         # 模型匹配
configFor()        # provider/model 路由
apply()            # llm/stream 拦截
```

如果 `llm/stream` 的 signature 变了，以新版 `GenerateOptions` 为准，不要继续用旧字段猜。

---

## 12. 接口清单

| 接口 | 用途 |
|---|---|
| `package.json.dsh.bundle.patch` | 声明这是 DSH bundle |
| `cordis.patch.yml` | 插入插件行，配置 targetRules / matchName / 可选 interceptModels |
| `apply(ctx, config)` | 插件入口 |
| `ctx.on('llm/stream', handler, { global: true })` | 拦截模型请求 |
| `ctx.llm.prepareCall(provider, model, controls)` | delegated 模式：取得原 provider 的调用句柄 |
| `prepared.stream(options)` | delegated 模式：把改好的 messages 交回原 adapter |
| `options.__weneedBypass` | 防止 delegated 重新进入本插件 |
| `ctx.llm.registerAdapter(...)` | 可选：注册自己的 provider（发布包不启用） |
| `ctx.get('credentials').resolve(ref)` | 可选自定义路由读取 DSH 凭据 |
| `ctx.get('systemPrompt').section(...)` | 可选：追加 system 引导 |
| `next()` | 未命中时交回原 adapter |

请求侧关键字段：

```text
provider, model, messages, tools, purpose, maxTokens,
temperature, reasoningEffort, signal
```

响应侧插件产出：

```text
block-start / text-delta / reasoning-delta / tool-call-delta
block-end / usage / finish
```

---

## 13. 隐私与安全

- 插件不包含 API key；`apiKeyEnv` 只是凭据引用。
- 发布包没有 `captureDir`、没有 harness、没有 telemetry。
- 插件不记录请求头、不写会话日志。
- 插件在 DSH Host 进程内运行，拦截后的请求会直接发往你配置的上游。
- 只安装你信任的 bundle；安装前阅读 `index.js` 和 `cordis.patch.yml`。
- GitHub 仓库不应提交 `.env`、`.credentials.yaml`、session 日志、请求捕获。

---

## 14. 验证与排错

### 安装后

```sh
dsh --profile desktop --dump-config
```

应出现：

```text
# == dsh-we-need-plugin
- id: dsh-we-need-plugin
```

### 没有注入

按顺序检查：

```text
1. 模型 id 是否命中 targetRules（默认只看 id，不看显示名）
2. options.purpose 是否非空（辅助调用）
3. 是否 tool step / compaction request
4. 是否被 target: false 显式关闭
5. DSH 是否有 ctx.llm.prepareCall（delegated 模式需要）
6. 如果用了可选 interceptModels 路由，检查 baseURL / apiKeyEnv
```

### 注入了但位置不对

检查 `lastRealTaskIndex` 和 context 识别；运行字段顺序与 seed 位置校验。

### 安装失败

- `not-a-bundle`：没有 `dsh.bundle.patch` 或路径不合法；
- `already-installed`：先 remove 再 install；
- `incompatible-version`：检查 `engines.dsh`；
- `restart-required`：重启 DSH；
- `build-blocked`：git 源码安装的依赖构建脚本未批准，改用 tarball/npm。

---

## 15. 发布

```sh
npm test
npm pack
```

产物：

```text
dsh-we-need-plugin-2.0.1.tgz
```

GitHub Release：

```sh
git tag v2.0.1
git push origin v2.0.1
gh release create v2.0.1 ./dsh-we-need-plugin-2.0.1.tgz --generate-notes
```

npm：

```sh
npm publish --access public
```

插件市场发现：

```text
package.json keywords: dsh-plugin, deepseek-harness
GitHub topic: dsh-plugin
可选：发布插件索引 JSON，列出 npm 或 git 来源
```

---

## 16. 文件结构

```text
dsh-we-need-plugin/
  package.json          # name/version/files/engines/dsh.bundle
  cordis.patch.yml      # plugin row + targetRules + matchName
  index.js              # injectSeed + isTarget + delegated + optional custom adapter
  seed.txt              # seed.txt 实际内容
  locale/               # en/zh metadata
  icon.svg
  README.md
  LICENSE
  tests/                # repository tests, not packed into npm tarball
```

---

## 17. 已知限制

- 语态是概率性的，seed 不是硬保证。
- delegated 模式使用原 provider adapter，支持原 adapter 支持的协议；可选的 `interceptModels` 自定义 adapter 只支持 OpenAI Chat Completions。
- delegated 模式保留原 adapter 的图片/文件处理；自定义 adapter 路线会把图片变成 `[image]` 文本占位。
- delegated 模式保留原 adapter 的跨模型历史过滤；自定义 adapter 的 `wireMessage()` 没有 same-model 检查，Kimi → DeepSeek 历史会把 Kimi reasoning 也带给 DeepSeek。这是当前已知差异。
- 默认不需要 provider 配置；任何 provider 都可用。
- delegated 模式的字段顺序由原 adapter 决定，不保证 DSH 自定义 wire 契约；需要精确字段契约时用 `interceptModels` 自定义路由。
- 工具步只在已有 `assistant(tool_calls)` 的 `reasoning_content` 追加 anchor+seed，不新增消息；其他 provider/adapter 的工具步形状尚未验证。
- checkpoint-only 且没有 tool-call assistant 时没有安全落点，不强行插消息（已知 no-op）。
- 连续压缩时可能出现 `summary is not smaller` 警告；这是 DSH compaction engine 的 checkpoint 再压缩问题，不阻断任务，暂不修。
- Qoder 不在本插件范围内；它需要单独的代理/镜像路线。
- 不做 token 计数、不做运行期 drift 统计/自动重锚。

---

## 更新说明

**3.0.0**：稳定的 We Need 思维链，极大提升 DeepSeek V4.1 Flash 执行计划的连贯性，减少无效思维，显著提升思维质量。支持标准模式 / goal 模式 / Team Agent 会话 / Response API（openai-responses），其他模式未验证（DSH 插件 3.0.0）。工具步重注入 seed 紧贴 task（bundle 默认开启）+ reasoning_content 签名归一；seed 新增 unlimited tokens。

**2.2.0**：修复工具步「运行工具后重述任务 / 漂移」根因（toolStepReseed，bundle 默认开启）+ pi-ai 序列化字段名归一（reasoning / reasoning_text → reasoning_content）。

**2.0.1**：稳定的 We Need 思维链，极大提升了 DeepSeek V4.1 Flash 执行计划的连贯性，减少无效思维，显著提升思维质量。适用于标准模式 DeepSeek V4.1 Flash（DSH 插件 2.0.1）。

- 修复 GitHub Issue #1：`openai-responses` wire 的 `thinkingSignature` 不再被覆盖为裸串 `reasoning_content`；保留 provider 原始 reasoning item JSON，旧损坏签名不再触发 `JSON.parse` 报错。
- 删除 `normalizeRegister` 当前 task assistant 历史改写，只保留自然 seed / tool anchor 引导。
- tool-call assistant 的 text content 在 adapter 与 delegated 路径发 wire 前清空；保留 reasoning、tool_calls、tool result 和 tool pair。
- 任务入口改为 deny-list：已知 runtime/skill/time/team/agent/subagent/审批等 context kind 排除；`goal`、`schedule`、`tool-goal` 及未来 task kind 走内容兜底，goal-only 会话也会注入 seed。
- 页面简介、README 原理和更新说明同步到 2.0.1。

---

## License

MIT
