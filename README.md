# DSH WeNeed Plugin

DeepSeek Harness（DSH）Host 插件：在模型请求的最后一条真实 user task 之前，插入一条 **728/728** 的 WeNeed assistant seed，让 DeepSeek Flash 更容易进入 `We need / Let's / We / Should` 的思维风格。

> 这是概率性引导，不是硬开关。它提高触发概率，但不保证每一次都进入 WeNeed 寄存器。

---

## 0. 先看这个

### 0.1 WeNeed 不是某一个模型，而是一类思维风格

WeNeed 不是 DeepSeek 独有的私有开关，也不是只能由某一家模型产生。它是一类以 **`We need`、`Let's`、`We`、`Should`** 作为句子开头为主要特征的思维风格：

```text
We need understand the task...
Need inspect the inputs...
Let's plan before acting...
Should verify against the requirement...
```

这种风格通常有三个特征：

- 注意力比较稳；
- 愿意连续调用工具推进任务；
- 很少陷入“雷霆大思考”——反复检查、反复自我修正、纠结细节。

一旦句子里大量出现 **`I`、`Let me`、`I will`**，通常说明模型的思维力被过多的混杂信息冲散了，开始从“推进任务”退化成“围着细节打转”。

### 0.2 三个最常见的干扰源

实际使用 DeepSeek 时，最容易把注意力冲散的是三类信息：

1. **工具信息过大**：工具 schema、工具调用历史、工具结果太多；
2. **工作区文件夹混杂**：长期在一个大目录里工作，项目多、文件多、临时文件多；
3. **skill 信息过大**：skill catalog 很长，或加载了很长的 skill 正文。

这些信息本身不是没用，但一旦过于庞大，就会把模型拉到细节里，失去对大局和任务清单的把控。表现就是“雷霆大思考”：反复读、反复比、反复改，迟迟不推进。

一个很实际的印证：

- 以 `Let me` 为主的涣散思维，完成任务时经常不知道自己该更新任务清单；
- 以 `We need / Let's` 为主的 WeNeed 模式，通常会主动完成任务，并知道更新任务清单；
- 但即使是 WeNeed 模式，有时也会忘记更新任务清单——这往往说明上下文里无意义、与思维不相关的混杂信息太多，已经影响了思维力和注意力。

### 0.3 使用 DeepSeek 的建议

- 工作区保持干净，项目尽量少；及时清空不必要的文件夹、临时文件和旧项目。
- 工具调用时间往后延：在 skill 目录不是特别大时，先让模型读 skill、做规划，最后再调用工具。不要让庞大的工具基座信息先冲散思维。
- 工具很多、文件夹很杂、skill 很长时，优先清理上下文；不要只依赖 seed。
- 出现 `Let me`、`I`、`I will` 时，先怀疑工具调用过多，或信息获取不当、过大；不要只怪模型。

### 0.4 适用边界：只适用于 DeepSeek Harness

本插件只针对 **DeepSeek Harness**。

测试过 Qoder：Qoder 在使用第三方 API 时，`reasoning_content` 不回传。上下文内容还在，但思维过程会丢失，所以同样的 seed 在 Qoder 上不能稳定生效。

那种情况只能走代理/镜像路线：把上下文里的内容克隆到思维字段里，让思维链不中断。这是另一条技术路线，不在本插件的范围内。

补丁说明：作者不是专业编程人员，对 reasoning 回传的底层机理可能理解不完整，也可能没有找到 Qoder 正确的回传方式，因此上面的判断可能是误判。如果 Qoder 后续版本提供了 reasoning 回传能力，请以实际版本为准。

---

## 1. 项目目的

DeepSeek V4.1 Flash 在一些特定语句的引导下，会进入一种可识别的 WeNeed 思维链：

```text
We need understand the task...
Need inspect...
Let's plan...
Need check...
```

本项目把这个现象做成一个 DSH 原生插件：不依赖外部 HTTP 代理，不修改工具，不修改采样参数，只在最终请求的 assistant 消息位置放入一段固定的 728 字 seed。

### 灵感来源

在 Kimi K3.1 Pro 与 DeepSeek V4.1 Flash 的上下文继承实验里，Kimi 经常产生 `We need / Let's` 风格的计划；当这段 assistant 历史被带进 DeepSeek 的上下文时，DeepSeek 有时会延续这种语态。

插件把这个观察压缩成一个更稳定的形式：

```text
不依赖 Kimi 先说话
→ 直接把一段 WeNeed assistant seed 放到 DeepSeek 的 task 前面
→ 让 DeepSeek 把它当成自己上一轮的思维延续
```

### 设计假设

```text
1. seed 放在 assistant 角色，比放在 user/system 更像“模型自己的上一轮”
2. content 与 reasoning_content 双通道同文，覆盖可见回复和思考通道
3. seed 紧贴 task，前面只放 runtime / skill / time context
4. 如果同时在 System Prompt 里加一段 WeNeed 引导，触发概率会更高
```

第 4 条是可选增强，不是本插件的默认行为；system prompt 改动影响所有步骤，也可能和 DSH 的身份/Agent Teams 文本冲突，需要单独 A/B。

---

## 2. 它做什么，不做什么

做：

- 在 `llm/stream` 层拦截目标模型请求；
- 在最后一条真实 user task 前插入 1 条 assistant seed；
- 同时写 `content` 和 `reasoning_content`，各 728 字符 / 728 字节；
- 保持 DSH 的工具步字段契约：`content=""`、`tool_calls` 无 `index`、tool pair 完整；
- 旧 seed 先剥离，再插新的，请求内最多 1 条；
- 不需要新增 provider，不需要在模型选择器里多选一个“中间商”。

不做：

- 不修改 `tools` / `tool_choice` / `temperature` / `max_tokens`；
- 不把 seed 写回 DSH 会话历史；
- 不在工具步追加 seed；
- 不做 content mirror；
- 不记录 API key、请求头、会话日志或 telemetry；
- 不保证首步一定进入 WeNeed。

---

## 3. 工作方式

```text
DSH agent loop
  → 组装 system / runtime / skill / time / task / history
  → 发出 GenerateOptions
  → llm/stream waterfall
       → 插件检查 provider/model
       → 命中 targetRules 且 interceptModels 有路由
       → 插件用自己的 OpenAI-compatible adapter 发请求
       → 在 task 前插入 assistant seed
       → 解析 SSE，按 DSH StreamChunk 返回
  → DSH 继续工具循环
```

没有命中时：

```text
yield* next()
```

请求原样交给 DSH 原来的 provider adapter。

---

## 4. 为什么是 728/728 双通道

seed 形状：

```text
assistant:
  content           = 728 chars / 728 bytes
  reasoning_content = 728 chars / 728 bytes
```

- `content` 是模型可见的 assistant 正文通道；
- `reasoning_content` 是思考通道；
- 两边同文，避免模型只看到“回答”而没看到“思考”，或反过来；
- seed 只存在于本次请求，不写回会话。

seed 文本在 `seed.txt`，加载时校验：

```js
if (SEED.length !== 728 || SEED_BYTES !== 728) throw ...
```

不要随便改 seed 长度；如果必须改，同步修改校验和测试。

---

## 5. 插入位置与含义

代码入口：`index.js` → `injectSeed()`。

| 位置 | 含义 | 是否默认做 |
|---|---|---|
| `messages[lastRealTaskIndex - 1]` | assistant seed，紧贴真实 task，模型把它当成自己的上一轮计划 | 是 |
| `content` 通道 | 可见回复通道的 prefill | 是 |
| `reasoning_content` 通道 | 思考通道的 prefill | 是 |
| System Prompt 追加段 | 全局语态引导，影响所有步骤 | 否，可选 |
| 工具步 `reasoning_content` | 模型自己的工具步计划，会被下一次请求继承 | 不注入，只继承 |
| 压缩后的新 task 前 | 压缩后重新锚定一次 | 是 |
| 压缩请求本身 | 摘要/压缩调用 | 否 |
| 标题/建议等辅助调用 | `purpose` 非空或极短请求 | 否 |

### 5.1 task 前 assistant seed

这是主插入点：

```text
... context ...
assistant: <728 seed>
user: <真实 task>
```

为什么是 task 前而不是 task 后：

- 模型生成下一步时，会把 seed 当成“自己刚刚的想法”；
- task 放在最后，模型第一眼看到的是任务；
- runtime / skill / time context 被移到 seed 前面，避免它们隔开 seed 和 task。

### 5.2 content + reasoning_content

DSH 的 assistant 消息可以同时有正文和 reasoning。两边同文是为了让模型在“可见回复”和“思考”两个通道都看到同一段语态。

### 5.3 System Prompt 引导

如果还想提高概率，可以在 system prompt 末尾追加一段 WeNeed 引导。推荐用 DSH 的 system prompt section seam，而不是改 profile 的 `personaSuffix`：

```js
const systemPrompt = ctx.get('systemPrompt');
systemPrompt.section({
  name: 'weneed:system-guidance',
  order: 10500,
  text: 'We need ... Let\'s ...',
  interpolate: false,
});
```

注意：

- 这不是 assistant seed，不能替代 task 前的 728 seed；
- 它会影响所有步骤，可能和身份文本冲突；
- 必须单独做 A/B，不要和 seed 改动混在一起；
- 本发布包默认不启用。

### 5.4 工具步 reasoning

工具步不注入新 seed，但工具步的 `reasoning_content` 会被下一次请求继承。实际会话里，工具步 reasoning 经常是整段计划，可能比首条 seed 更长。它既可能延续 WeNeed，也可能把 `Let me` 带起来；这是 seed 之后的主要漂移来源。

### 5.5 压缩

压缩请求本身不注入；压缩后的新 user task 正常注入；压缩后如果仍是 tool step，不重种。

---

## 6. 即插即用：不新增 provider

发布包**不注册自己的 provider**。

`cordis.patch.yml` 里没有 `provider` / `models` / `reasoningEfforts`，所以模型选择器不会多出一个“WeNeed 中间商”。插件只做两件事：

```text
1. 监听 llm/stream
2. 拦截已有的 DeepSeek Flash provider/model
```

代码里也做了条件注册：

```js
if (typeof config.provider === 'string' && config.provider.length > 0) {
  ctx.llm.registerAdapter([adapter.provider], adapter);
}
```

发布包不设置 `provider`，因此不会注册 adapter；它仍然是纯拦截器。

如果你要做本地测试、想暴露一个自己的 provider，可以在配置里加：

```yaml
provider: weneed-native
models:
  - id: deepseek-v4.1-flash
    name: DeepSeek-V4.1-Flash
    baseURL: https://your-upstream/v1
    apiKeyEnv: YOUR_API_KEY
```

这不是发布包的默认形态。

---

## 7. 安装

### npm

```sh
dsh plugin --profile desktop add dsh-weneed-plugin@0.5.0
```

### tarball

```sh
npm pack
dsh plugin --profile desktop add ./dsh-weneed-plugin-0.5.0.tgz
```

### GitHub

```sh
dsh plugin --profile desktop add github:Lichadai/dsh-weneed-plugin#<commit>
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
(model id + display name) 同时包含 deepseek 和 flash
大小写不敏感
provider 不参与匹配
```

所以 `deepseek-v4-flash`、`deepseek-v4.1-flash`、`DeepSeek-V4.1-Flash`、`deepseek-v4.1-flash-1017` 都会命中。

### 8.2 interceptModels：请求发到哪里

`interceptModels` 不决定是否注入，只决定命中后使用哪个上游地址和凭据引用。

```yaml
intercept: true
targetRules:
  - [deepseek, flash]
interceptModels:
  - provider: opendesign
    id: deepseek-v4.1-flash
    name: DeepSeek-V4.1-Flash
    baseURL: https://amr-link.open-design.ai/v1
    apiKeyEnv: OPENDESIGN_API_KEY
  - provider: baicai
    id: deepseek-v4.1-flash-1017
    name: DeepSeek-V4.1-Flash-1017
    baseURL: https://sharellm.net/v1
    apiKeyEnv: BAICAI_API_KEY
```

字段含义：

| 字段 | 含义 |
|---|---|
| `provider` | DSH provider route，必须完全一致 |
| `id` | DSH model id，必须完全一致 |
| `name` | 用于 `targetRules` 的显示名 |
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

### 9.2 换 provider / 模型 id / 显示名

改 `interceptModels` 对应条目：

```yaml
- provider: d4
  id: deepseek-v4.1-flash-1017
  name: DeepSeek-V4.1-Flash-1017
  baseURL: https://dashscope.aliyuncs.com/compatible-mode/v1
  apiKeyEnv: D4_API_KEY
```

- `provider` 必须和 DSH profile 的 provider route 一致；
- `id` 必须和模型选择器里的 model id 一致；
- `name` 是 `targetRules` 的匹配来源之一；
- `baseURL` 和 `apiKeyEnv` 必须指向真实上游和已有凭据。

### 9.3 改上游地址 / API key

只改 `baseURL` 和 `apiKeyEnv`。不要把 key 值写进插件。

插件运行时：

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

### 9.4 改 seed

编辑 `seed.txt`，同时确认：

```text
length == 728
Buffer.byteLength == 728
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

### 10.6 只对某个 provider 生效

`targetRules` 本身不检查 provider。要限制 provider，只给那个 provider 配置 `interceptModels` 路由；其他 provider 没有路由，会原样透传。

```yaml
interceptModels:
  - provider: baicai
    id: deepseek-v4.1-flash-1017
    ...
```

### 10.7 对多个 provider 生效

为每个 provider 各写一条路由：

```yaml
interceptModels:
  - provider: opendesign
    id: deepseek-v4.1-flash
    ...
  - provider: baicai
    id: deepseek-v4.1-flash-1017
    ...
  - provider: d4
    id: deepseek-v4.1-flash-1017
    ...
```

匹配仍然只看模型名；路由只是按 `provider/model` 精确查表。

### 10.8 模型 id 是 opaque 的情况

如果 model id 没有 `deepseek` / `flash`，但显示名有，把显示名写进 `interceptModels[].name`：

```yaml
- provider: my-provider
  id: model-x
  name: DeepSeek-V4.1-Flash
```

`isTarget` 会同时检查 id 和 name。

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
| `cordis.patch.yml` | 插入插件行，配置 targetRules / interceptModels |
| `apply(ctx, config)` | 插件入口 |
| `ctx.on('llm/stream', handler, { global: true })` | 拦截模型请求 |
| `ctx.llm.registerAdapter(...)` | 可选：注册自己的 provider（发布包不启用） |
| `ctx.get('credentials').resolve(ref)` | 读取 DSH 凭据 |
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
# == dsh-weneed-plugin
- id: dsh-weneed-plugin
```

### 没有注入

按顺序检查：

```text
1. 模型 id/name 是否命中 targetRules
2. provider/model 是否有 interceptModels 路由
3. options.purpose 是否非空（辅助调用）
4. 是否 tool step / compaction request
5. 是否被 target: false 显式关闭
6. 上游 API key 是否能解析
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
dsh-weneed-plugin-0.5.0.tgz
```

GitHub Release：

```sh
git tag v0.5.0
git push origin v0.5.0
gh release create v0.5.0 ./dsh-weneed-plugin-0.5.0.tgz --generate-notes
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
dsh-weneed-plugin/
  package.json          # name/version/files/engines/dsh.bundle
  cordis.patch.yml      # plugin row + targetRules + interceptModels
  index.js              # injectSeed + isTarget + configFor + llm/stream
  seed.txt              # 728/728 seed
  locale/               # en/zh metadata
  icon.svg
  README.md
  LICENSE
  tests/                # repository tests, not packed into npm tarball
```

---

## 17. 已知限制

- 语态是概率性的，seed 不是硬保证。
- 只支持 OpenAI Chat Completions 兼容上游；Anthropic Messages / OpenAI Responses 需要扩展 adapter。
- 图片内容会变成 `[image]` 文本占位。
- 跨模型历史：DSH 原生 pi-ai 会丢弃其他模型的 thinking；本插件的 `wireMessage()` 没有 same-model 检查，Kimi → DeepSeek 历史会把 Kimi reasoning 也带给 DeepSeek。这是当前已知差异。
- 不做 provider 自动发现；新增 provider 需要手写 `interceptModels` 路由。
- 不做 token 计数、不做 drift 重锚、不在工具步追加 seed。

---

## License

MIT
