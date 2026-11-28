# Changelog

## 4.4.4

- **开工后冻结缓存前缀**：`orderContextsBeforeAllTasks` 改为 `orderContextsBeforeFirstResponse`。每个 task 段只把“task 之后、第一条 assistant/tool 之前”的初始 context 前移到 task 前；task 开工后新注入的 `time-context`、runtime context、进度提示等全部保持宿主追加位置，不再跨过 task。修复 4.4.3 在连续工具步中把新 context 前移、导致 task 之后整段历史失效的问题。
- **根因证据**：最新 PTC 会话 step 11 宿主追加 `time-context`（`Elapsed since the preceding step context: 11m 8s.`），4.4.3 将其移到 task 前，task 后约 137k 历史右移；输入 154,132，`cacheRead` 仅 17,024，单步命中 11.05%。step 8/10 的低命中对应上一步 41.7k/31.1k 新输出，属于正常不可缓存成本。
- **保留全部思维链承重件**：`seed.txt` 的 Kimi 原文不改；合成 seed 的 `content`/`reasoning_content` 仍为同一份全量块；`normalizeReasoningChannelMessages` 仍跨全部历史归一为 `reasoning_content`；`contentFillScope: task`、`toolStepSeedPlacement: assistant`、`toolStepReasoning: anchor-seed`、`toolStepReseed: true` 全部不变。
- **测试**：新增 `tests/ordering-444.test.mjs`（step 11 late context / 续接旧前缀冻结 / 初始 context 前移 / compaction 边界 / seed 双通道）；原 13 套件 + 新套件共 14 套全绿。

## 4.4.3

- **续作前缀缓存修复**：新增 `orderContextsBeforeAllTasks`，对所有真实 task 组统一执行 context-before-task 排序。此前只把“最后一个 task 之后的 context”前移；续作出现新 task 后，旧 task 的 context 不再满足条件，host 持久化顺序翻转，首条续作请求只剩 system+tools 前缀可命中（实测只缓存 11,776 tokens，命中 20.0%/16.1%）。现在新旧 task 的前缀顺序一致。
- **content 回填范围可配**：新增 `contentFillScope: all | task | latest`（bundle 默认 `task`）。`task` 只回填当前 task scope，旧 task 历史保持字节稳定；`latest` 只填空 content 的最新 tool-call assistant。`all` 保留 4.3.1 的跨边界镜像行为。
- **seed 结束边界**：定向块在 raw seed 之后、上一步 reasoning/continue 之前增加 `Need end of style example...`。此前只有开头标注，弱提示续作会把 seed 的问候原文感知成“上一轮粘贴的奇怪 reasoning”；结束边界用于明确示例的闭合位置。
- 新增 `ordering-443.test.mjs`，content-fill 增加 scope 用例；`seedOrientation: off` 仍保持 4.3.2 行为。12+1 套件全绿。

## 4.4.2

- **合成 seed assistant 双通道同文**：非 tool-call 的新任务 seed 现在让 `content` 与 `reasoning_content` 逐字承载同一份完整定向块（todo、上下文占用、标注+seed、上一轮 reasoning、continue），不再在 reasoning 通道单独追加裸 seed。
- `isSeed` 增加 `weneed-seed-*` ID 识别，保证定向块改写后旧 seed 仍能在下一次请求前被替换，不会累积。
- 工具步仍只在现有 tool-call assistant 内调整，不新增消息、不改 tool result、不拆 tool pair。

## 4.4.1

- **full 模式顺序改为当前状态优先**：`todo → 上下文占用 → 标注 + raw seed → 上一步 reasoning → continue`，真实 task 紧贴 seed。首轮缺 todo/usage/previous 时仍退化为 `label + seed + continue`，缺省节省略、不编造。live PTC 同 prompt 对照（2 次旧顺序 + 2 次新顺序）：新顺序 12/12 请求合格，旧工具步 0/11 合格；仅单任务小样本，不写因果。
- **发布 bundle 默认 `seedOrientation: full`**：4.4.1 安装后直接使用上述顺序；显式设 `off` 可回到 4.3.2 行为。
- **todo 清单改"投影优先 + 历史兜底"**：full 模式优先读宿主当前 `todos` 投影（`ctx.sessionProjections.stateOf(session,'todos')`，todo/write 事件 last-write-wins 折叠，工具步期间 populated、抗压缩），轮次开头 turn/start 投影清空时退回历史最近 `todo_write` 调用。审计加 `orientationTodosSource: projection|history|none`。
- 读法权衡：stateOf 虽标 deprecated 但每 key 仅 warn 一次、未注册返回 undefined（fail-soft）；另一条 register 同 key handle 的路会耦合 tool-todo 的 stateVersion，DSH 升级即加载失败，故读-only 场景选 stateOf 更稳。
- 承重机制不变；off 仍与 4.3.2 字节一致。测试 orientation.test.mjs 加用例 14（投影优先/空投影兜底/无投影兜底）；12/12 全绿。

## 4.4.0

- **新增可选 `seedOrientation` 定向块（off | example | full，默认 off；关闭时与 4.3.2 字节一致）**：把 seed 的可见 content 标注为"思维示例"——冒号+换行引出 raw 原文，**不打引号**（裸第一人称思维与 reasoning 通道同形，便于模仿，避免引号把 trace 外部材料化）。`example` 仅标注+示例+继续句；`full` 再附三件定向信息：上一步 reasoning（`lastAssistantReasoning`，逐字复制）、当前 todo 清单（`lastTodos`，从历史最近 `todo_write` 调用取，整表替换语义）、provider 实测上下文占用（宿主全局 `tokenMeter.contextPressure(session)`，经 `options.sessionId` → `ctx.agents.get(sessionId).session`）。
- **承重机制不动**：reasoning 通道保持 raw SEED → `isSeed` 精确匹配、`hasSeedAfter`/SEED_HEAD、`reasoning_content` 通道归属（4.3.2）全部照旧；白名单任务锚、`orderContextsBeforeTask`、contentFill 空 content 幂等守卫、sanitize 范围均不变。定向块只改 assistant 可见 content text 块。
- **数据缺省诚实省略**：首轮无上一步、压缩后历史丢失、无 todo 历史、首个请求前无 usage → 对应节省略，不编造、不拿估算冒充实测。宿主服务取不到 → fail-soft 降级（照 audit best-effort 模式），绝不阻断注入。多窗口安全（tokenMeter 按 session 隔离）。
- contentFill 最新工具回合在 orientation 开启时用 `orientationFillHead()`（标注+示例+继续句）替换 bare seed+continue-work，回合自身 reasoning 仍按原样追加（不重复复制）。
- 研究依据：`RESEARCH-SEED-ORIENTATION-20261124.md`（四要素数据源亲证 + 冒号vs引号采纳分析 + A/B 计划）。**采纳净效应待 live A/B，默认 off 不改变现有行为。**
- 测试：新增 `tests/orientation.test.mjs`（off 字节不变 / example / full 形状 / 缺省省略 / isSeed 剥离 / contentFill / 幂等 / todo 提取 / 禁词）。
- 版本升到 4.4.0；package 描述同步；cordis.patch.yml 显式 `seedOrientation: off`。

## 4.3.2

- **reasoning_content 通道归一跨任务边界（中断续作"重新推导"级联的根因修复）**：`normalizeReasoningChannelMessages` 去掉 `index < scopeStart` 跳过，**所有 assistant 回合（含边界前历史）的 reasoning 签名都归一成 `reasoning_content`**。
- 根因（4.3.1 live wire + 逐字取证）：网关只读 `reasoning_content`，pi-ai 按 block 的 `thinkingSignature` 回放字段名。中断续作时历史在边界前不被归一 → 签名 stays `reasoning` → pi-ai 发 `reasoning` 字段被网关丢 → 模型失去"自己之前的思考"。4.3.1 镜像把 reasoning 塞进 content（可见话语），模型看得到前文但当作**外部断言**而非自己的思考 → 不信任中断前结论（"But that was before the interruption"/"my earlier sample was wrong"/"task is a trap/injected false premise"）→ 重新推导已确认颜色 → But×44/maybe×20/Wait×6/However×4 级联，第一个 letMe 由"Wait—could the beak actually be a different orange?"（自己刚采样确认 #ffa500 又怀疑）触发。
- 修复后历史 reasoning 以 `reasoning_content` 身份续上 → 模型**拥有**中断前的思考 → 顺着续而非重审。reasoning 文本不变，只归一通道签名（`withSingleReasoningBlock` + `replaySignatureFor`），幂等（`reasoningChannelClean` 守卫）。
- 与 4.3.1 互补：4.3.1 修可见 content（起句 The user→We need），4.3.2 修 reasoning 通道归属（消除重新推导/However 级联）。两者都跨边界，使中断续作的通道处理与正常不中断续作一致。
- 测试：新增 `tests/reasoning-channel-432.test.mjs`（边界前历史签名归一为 reasoning_content、文本不变、wire 发 reasoning_content、tool_calls 保留、幂等、多回合、可见话语不动）。
- 版本升到 4.3.2；package 描述同步。

## 4.3.1

- **contentFill 跨任务边界镜像历史（中断/续作语态接续修复）**：`fillAssistantContent` 的 reasoning 镜像分支不再被 `scopeStart` 挡住——**所有空 content 的 assistant 回合（含当前任务边界之前的历史）都填上它自己的 reasoning**；只有当前任务段最新工具回合维持 `seed+continue-work+reasoning`（`latest` 限定 `index>=scopeStart`）。
- 根因（live wire 取证）：4.3.0 中断续作复跑，续作轮第一条 reasoning 仍以 "The user wants me to continue… The requester says…" 起句 + letMe（全轮 33840 字符 letMe=41）。wire 显示续作首请求里**中断前 6 个 assistant 回合 content 全空**（WeNeed reasoning 只在 reasoning 通道）；contentFill 因 `scopeStart=taskScopeStart`（边界落在纠正消息之后）跳过历史 → 没把前文续上。OpenDesign 读 content、轻视 reasoning_content → 历史无可见 WeNeed 声音 → 续作重新开局成描述腔。
- 修复即用户指出的"空的 content 就把 reasoning 弄进来"：复用既有 mirror 语义（`mirrorAssistantMessage` 把回合自身 reasoning 镜像进自身空 content），但由 contentFill 跨边界执行。镜像不改 reasoning 文本/语义，属忠实接续，非改写旧任务。
- 结构侧（4.3.0 白名单）已验证全对：25/25 请求 seed 紧贴真实任务、nudge 重排到 seed 前、taskHash 不翻转；本版补的是**采纳侧的历史可见语态接续**。
- 测试：`content-fill.test.mjs` 新增用例 10/11（续作边界前历史空 content 被镜像、当前段最新工具回合仍 seed+continue、历史不重复 seed、reasoning 通道与 replayState 不变）。
- 版本升到 4.3.1；package 描述同步。

## 4.3.0

- **任务入口反转为白名单（根本性健壮修复）**：`isTaskUser()` / `isContextUser()` 不再依赖 `CONTEXT_SOURCE_KINDS` 黑名单。新增 `TASK_SOURCE_KINDS = {goal, schedule, tool-goal}`，只有 `user` 与该白名单内的 kind 是任务；**其它任何带 `source.kind` 的消息（含未来 DSH 新增的工具/提醒/上下文种类）一律默认上下文**。只有完全无 kind 的旧式/委派消息才走文本/图片兜底。
- 解决的脆弱性：4.2.1 靠把 `progress-updates-nudge` 等新种类逐个加进黑名单来修复误判；DSH 下次再新增种类仍会复发。白名单使「未知种类 → 上下文」成为默认安全失败模式（表现为可检测的 `no-user-task` 不注入，而非静默把 seed 锚到提醒上导致语态漂移）。
- 关键性质：带 kind 的消息以 kind 为准，**即使其文本看起来像真实任务**（如 “Need refactor the whole module now.”）也不会抢占锚点；`orderContextsBeforeTask()` 自动把任何新上下文种类重排到真实任务之前，seed/reasoning/content 始终紧贴真实 task。
- 保留 `goal` / `schedule` / `tool-goal` 为任务（goal-only 会话仍注入 seed）；保留 4.2.x 的 contentFill、压缩 register、Team hint、tool-step reseed、nearest guidance 等全部配置。
- 测试：`features-2.1.0.test.mjs` 把 `future-task-kind` 断言由「任务」翻转为「上下文」；新增 `tests/allowlist-430.test.mjs`（任意新种类→上下文、任务样文本不抢锚、新种类单独出现→no-user-task、白名单四种仍为任务、无 kind 文本兜底、工具步新种类重排到 seed 之前）。
- 版本升到 4.3.0；README task 入口表/goal 说明、package 描述同步。

## 4.2.1

- 修复 DSH 连续工具调用进度提醒 `progress-updates-nudge` 被误判为 task：长任务中断/续作时该提醒抢占 seed 锚点，导致首句漂移回 lazy 语态（letMe 计数回升）。把 `progress-updates-nudge`、`team-board-notice`、`skill-invocation`、`dsh-session-title-llm` 加入 `CONTEXT_SOURCE_KINDS`；`goal` / `tool-goal` 仍为任务。
- 新增 `tests/context-kinds-421.test.mjs` 覆盖上述种类与工具步重排。实测中断轮 reasoning 23048 字符 `letMe=0`（4.2.0 为 15）。
- 版本升到 4.2.1。

## 4.2.0

- **通用 content 填充杠杆 `contentFill: seed-continue-reasoning`**：把空 assistant content 填为 `seed + continue-main-work + reasoning 复制`（最新工具调用轮），更早的空 content 轮镜像 reasoning；覆盖 user-task 与工具步，保住中断/续作语态，弥补 DSH 插件无 proxy mirror 的缺口。
- 简化 `COMPACTION_REGISTER` 为正常 WeNeed 语态，删除「上上次 / second-to-last」规则（content 填充已保住前步 reasoning，无需特提醒）。
- 清除「工具步 content 必须为空」的错误结论：`stripToolCallContent` 默认 false，content 可为非空可见正文。
- 新增 `tests/content-fill.test.mjs`；版本升到 4.2.0。

## 4.1.0

- TeamAgent 外发升级：`TEAM_REGISTER_HINT` 明确覆盖 teammate、sub-agent 与 workflow agent(prompt)，不再只写 “Every message or task sent to a teammate”。
- `TEAM_HINT_TOOLS` 从 7 个增加到 8 个，新增 `workflow`；`subagent` / `subagent_fork` 继续覆盖。只追加 tool description，不改名称、参数、结构、tool_choice 或消息。
- 保留 4.0.1 的 content 保留修复：`stripToolCallContent` 默认 false，tool-call assistant 的已有 text 不再被清空。
- 保留 882 seed、compaction register、Team hint、tool-step reseed、nearest guidance 等既有配置。
- 版本升到 4.1.0；README、locale、package 描述同步。

## 4.0.1

- 修复 tool-call assistant 的 content 被默认清空：DSH 接受非空 content；`stripToolCallAssistantContent()` 改为仅在显式 `stripToolCallContent: true` 时执行，默认保留已有正文、tool-step anchor 和旧 mirror 留下的 text。
- `wireMessage()` 在 tool-call assistant 上不再丢弃已有 text；`mirrorToolSteps` 仍只在显式开启时用 reasoning 填充空 content。
- 默认配置增加 `stripToolCallContent: false`；补回归测试覆盖 adapter/delegated 两条路径、显式 strip opt-in、tool-step anchor 保留。
- 版本升到 4.0.1；README、locale、package 描述同步。

## 4.0.0

- 提升 DeepSeek V4.1 Flash 的规划与执行能力：seed 继续使用仿 Kimi K3.1 Pro 的完整决策轨迹（任务复述 → 约束 → 候选 A/B → 风险检查 → 选定 → 祈使收尾）；本版以 live 的 882 字符抽象决策版为准，保留具体候选动作与选择理由，不退回抽象词表。
- Team 外发提示词重写：不再要求“每句都以情态词开头”，改为 `Need / Should / Could / Can / Must / May` + `We need / We should / We can / Let's` 的语义分工与句式混合；长消息至少两个不同情态开头 + 一个普通句，避免外发消息退化成纯祈使流程。
- 保留 `send_message` / `spawn_teammate` / `subagent` / `subagent_fork` / `team_task_create` / `team_task_update` / `remote_send_message` 七个覆盖点；只追加 description，不改工具名、参数或结构。
- 版本升到 4.0.0；README 增加推荐提示词（带高频规划词）和简短事例；package/locale 描述同步为“极大提升 DeepSeek V4.1 Flash 的能力”。
- 保留 3.3.0 的 seed/compaction/nearest/tool-step 配置；`toolDescriptionSeed` 仍默认 off，D 配置仅作对照。

## 3.3.0

- seed 改为 Kimi K3.1 Pro 决策型 reasoning 的 We 版（931 字符 / 1375 字节，无 `I` 起句）。
- compaction register 改为 `Need / Should / Can / Could / Must` 起句，并要求 checkpoint 含“上一步实际执行”的同句式摘要。
- Team 外发提示改为 need-first，明确“发给 teammate 的每条消息就是给对方的 prompt”，覆盖 7 个外发工具。
- `nearestGuidance`、`toolStepAnchor`、`toolDescriptionSeed`、`taskPolicy` 同步改为 need-first。
- 默认最终配置：完整 seed bundle + `nearestGuidance: both` + `teamRegisterHint: true` + `toolDescriptionSeed: off`；D 保留为实验对照。

## 3.2.0

- 实验版（A/B/C 对比，默认配置 = 3.0 行为）。新增底座开关 + 输出侧引导杠杆，全部按稳定字段名定位、追加/填充式、升版不坏：
  - `seedInjection`（默认 true）：是否注入 seed assistant 消息。
  - `reorderContexts`（默认 true）：是否把 task 之后的 context 移到 task 前（orderContextsBeforeTask + contexts→seed→task）。
  - `sanitizeProgram`（默认 true）：是否清洗 system/工具描述。
  - `nearestGuidance`（默认 off；content/reasoning/both）：在最近一条 assistant(tool_calls) 的 content（仅空时填、不覆盖模型自身正文）与/或 reasoning_content 末尾填入干净集体引导 NEAREST_GUIDANCE（继续导向、let/need 为主、自然分布）。幂等、replayState 对齐、不新增消息、不拆 tool pair。
  - `teamRegisterHint`（默认 false）：给 send_message / spawn_teammate / subagent / subagent_fork 的 description 末尾追加软性 register 指令——直接让外发消息/任务用集体语态写（非 seed hint）。只追加、不改名/参数/结构。
- A/B/C（运行配置见 `experiments/cordis.{A,B,C}.yml` + `experiments/EXPERIMENT.md`）：共同杠杆 `nearestGuidance:both`+`teamRegisterHint:true` 三组都开。3.0 的 seed 是一个 bundle（injectSeed + toolStepReseed + toolStepReasoning 的 seed 部分 + postCompactionSeed），故 B↔C 把整个 bundle 作为单一变量：A/B seed-free（`seedInjection:false`、`toolStepReasoning:anchor` 只留短锚不含 seed、`postCompactionSeed:off`），C 完整 3.0（`anchor-seed`+`reasoning`）。A↔B 仅 `reorderContexts` false→true。`sanitizeProgram`（3.0 标准清洗，非 you→we 改写）及其余非 seed 杠杆三组恒定。C=完整 3.0+引导；A=无 seed/无移动+引导；B=3.0 去 seed 留移动+引导。
- 离线实证：6 套件绿（含新 nearest-output-ab.test）；tmp/verify-abc-configs.mjs 23 项全过——A/B 用户轮与工具步 wire 均无 seed、C seed 紧贴 task 且工具步 reasoning 含 seed；三组最近 reasoning 均有引导、Team 描述均有 hint；88 工具数量/名称/参数骨架逐字节不变；A↔B 仅 reorder 异、B↔C 仅 seed bundle 异。
- 依据 2026-11-11 更正：content 可非空、网关接受，填干净引导是已验证杠杆（letMe=0）；mirror 模型自身漂移 reasoning 才放大漂移；绝不写 role:tool content。
- 实验版：真实采纳 A/B 待跑（dsh-live-session-debug）；live 安装/发布待确认。

## 3.0.0

- 升版 3.0.0：2.2 的工具步重注入 + 签名归一相对 2.1 是行为级变化，按主版本发布。bundle 默认 `toolStepReseed: true`，标准安装即生效。
- seed 增强：unlimited 资源句新增 `unlimited tokens`（与 unlimited memory / compute / inference 并列）。
- 简介补充已核实的模式支持：**标准模式**；**goal 模式**（`isTaskUser` deny-list  fall-through，goal-only 会话也注入 seed）；**Team Agent 会话**（team-message / agent-message / subagent-report 等归入 CONTEXT_SOURCE_KINDS 按上下文处理，seed 仍注入真实任务）；**Response API**（openai-responses：replaySignatureFor 保留 provider 原始 reasoning 签名；seed 消息按 completions 构造，responses wire 完整 live 验证待补）。其他模式未验证。
- 全套件绿（injection / features / toolstep-reseed / signature-normalize / package）。

## 2.2.0

- 修复工具步「运行工具后重述任务/漂移」根因：seed 是合成消息、DSH 不持久化进历史，旧 `injectSeed` 在工具步剥掉 seed 又不重注入，导致工具步请求丢失紧贴 task 的 WeNeed 锚点。新增 opt-in `toolStepReseed`：工具步分支复用首轮 `contexts→seed→task` 逻辑，把 seed 重新注入紧贴 task（含 isTarget 守卫）。live wire 确证每个工具步 seed 紧贴 task；语态两轮 letMe=0–1（修复前全程漂）。
- 修复 pi-ai 序列化字段名漂移：上游用 `reasoning`/`reasoning_text` 字段回思考时，pi-ai 原样 replay 成该字段，网关只读 `reasoning_content` → 计划丢失。`replaySignatureFor` 在 openai-completions 分支把三个 plain 别名统一归一成 `reasoning_content`（JSON reasoning-details 签名保留，非 completions 不变），恢复 1.0.9 的归一化行为。
- 新增 tests/toolstep-reseed.test.mjs（off 默认/on 紧贴/idempotent 不累积/non-target 不注入）与 tests/signature-normalize.test.mjs；全套件绿。
- 发布 bundle 默认开启 `toolStepReseed: true`（cordis.patch.yml），标准安装即获得工具步重注入修复；库级 `injectSeed` 参数仍默认 false（opt-in API 契约不变），mirror 默认 false。

## 2.1.0

- 承重墙（方案 A）：注入决策写入持久外部审计 `~/.dsh/weneed-audit.jsonl`（ts/version/provider/model/purpose/reason/injected/seedHash/taskIndex/taskHash）。第三方插件经核实不能写 in-log 插件记录（`appendPluginRecord` 仅第一方）、不能插入 assistant 轮，故采用外部审计 + 离线读取工具 `bin/weneed-audit-read.mjs` 取证；in-log 持久化需第一方支持（已记缺口）。
- purpose 权威：`purpose:'compaction'` 成为压缩权威判据（injectSeed + appendCompactionRegister force + apply bypass），文本嗅探降为 fallback，宿主改文案不再静默丢 register。
- 可观测：两处静默 `catch→next()`（prepareCall 失败）改为带上下文审计记录，失败可见。
- 恢复并适配回归测试（injection.test.mjs 移除已删的 normalizeRegister 块；package.test.mjs 版本断言升 2.1）；新增 features-2.1.0.test.mjs（purpose 权威 + goal/context kind 矩阵）。三套测试全绿。
- 配套代理（Qoder 8799 线，独立仓库）：liveSeedPresent 单一事实源修复 P0 虚报、GOAL deny-list 移植、审计按路线 seedHead + liveSeedPresent；DSH 8797 线本轮不动。

## 2.0.1

- 修复 GitHub Issue #1：`openai-responses` wire 的 `thinkingSignature` 不再被覆盖为裸串 `reasoning_content`；保留 provider 原始 reasoning item JSON；旧损坏签名不再触发 `JSON.parse` 报错。
- 删除 `normalizeRegister` 当前 task assistant 历史改写；只保留自然 seed / tool anchor 引导。
- tool-call assistant 的 text content 在 adapter 与 delegated 路径发 wire 前清空；保留 reasoning、tool_calls、tool result 和 tool pair。
- 任务入口改为 deny-list：已知 runtime/skill/time/team/agent/subagent/审批等 context kind 排除；`goal`、`schedule`、`tool-goal` 及未来 task kind 走内容兜底，goal-only 会话也会注入 seed。
- 页面简介、README 原理和更新说明同步到 2.0.1。

## 2.0.0

- 稳定的 We Need 思维链，极大提升了 DeepSeek V4.1 Flash 执行计划的连贯性，减少无效思维，显著提升思维质量。适用于标准模式 DeepSeek V4.1 Flash（DSH 插件 2.0.0）。
- README 原理重写：DeepSeek V4.1 Flash 注意力窄；计划和上一轮思考被工具调用/结果隔开后，会抓住最近材料；插件把计划与上一轮 reasoning 移到最近位置。
- 包含 1.0.9 的 `purpose=compaction` 风格修复、工具步 anchor+seed、`source.kind` task anchor、图片首轮修复、压缩后 seed。
- 已知：连续压缩 no-op 警告暂不修；checkpoint-only 无安全落点 no-op。

## 1.0.9-local-collective-modals-toolreasoning-pure

- 稳定的 We Need 思维链，极大提升了 DeepSeek V4.1 Flash 执行计划的连贯性，减少无效思维，显著提升思维质量。适用于标准模式 DeepSeek V4.1 Flash（DSH 插件 1.0.9）。
- System messages and tool definitions are sanitized before the wire: task-subject phrases that name the requester in third person are rewritten to "the requester", and legacy first-person / hesitation phrases are neutralized. User tasks, assistant history, and tool results are not rewritten.
- Tool names, parameter keys, and schema structure are unchanged; only `description` / `title` / `summary` text is sanitized.
- Runtime source no longer contains contiguous drift phrases; the remaining detectors build their patterns from fragments.
- Added unit and intercept-path tests proving system/tool sanitization and source purity.

## 1.0.9-local-collective-modals-toolreasoning

- Assistant history is normalized to one `reasoning_content` channel: the first reasoning block keeps the plan, duplicate reasoning blocks are merged, `reasoning_details` / `reasoning` aliases are removed, and `source.replayState.blocks` is updated to `thinkingSignature: reasoning_content`.
- On every tool step, the latest `assistant(tool_calls)` keeps its own plan and receives the 134-char tool anchor plus the full seed in the same `reasoning_content` channel (`toolStepReasoning: anchor-seed`).
- `content`, tool calls, ids, arguments, tool results and message count are unchanged; no new message and no tool-pair split.
- The append is idempotent and scoped after the current task / compaction checkpoint.

## 1.0.9-local-collective-modals-toolstepfix

- `wireMessage()` now forces DSH tool-call assistant `content` to `""`; only the explicit `mirror && mirrorToolSteps` A/B path may put text or reasoning back into content.
- Tool-step requests move runtime/skill/time contexts back in front of the current task, matching the first-request order; the move stops at a compaction checkpoint.
- `taskPolicy` is reapplied idempotently on tool steps, so the policy is not lost after the first tool result.
- No new seed is inserted at tool steps; message count, tool calls, ids and results are unchanged.
- Added regression tests for empty tool-call content, context order, policy idempotency and compaction guard.
- The 1.0.8 note that policy is skipped for tool steps no longer applies.

## 1.0.9-local-collective-modals-dshfix

- DSH contract fix: `mirror: false`, `mirrorToolSteps: false`, `toolStepAnchor: off`.
- Tool-call assistant `content` stays `""`; reasoning is sent only as `reasoning_content`.
- `reasoning_details` is read by `reasoningTextOf()` and copied into `reasoning_content`; the request never emits `reasoning_details`.
- Keeps `normalizeRegister: bold`, `taskPolicy: true`, `postCompactionSeed: reasoning`.

## 1.0.9-local-collective-modals-wirefix

- Fixed `wireMessage()` to read reasoning with `reasoningTextOf()` instead of `reasoningOf()`.
- A tool-call assistant that carries thinking only in `reasoning_details` now emits a non-empty `reasoning_content` on the wire.
- The wire field stays `reasoning_content`; this is a source fix, not a field rename.
- Tool calls, ids, arguments, tool results and message count are unchanged.
- Added a regression test for the `reasoning_details`-only tool-call shape.

## 1.0.9-local-collective-modals

- Added collective auxiliary forms: `Should I` -> `Should we`, `Can I` -> `Can we`, `Am I` -> `Are we`, and the same for other common modals.
- This closes the remaining singular first-person form in review/verification questions.

## 1.0.8-local-task-policy

- Added `taskPolicy: true`: a short positive WeNeed register instruction is appended after the real user task.
- The policy contains only positive `We need` / `Need` / `Let's` wording; it does not add negative drift examples.
- The policy is appended once per task, is idempotent, and is skipped for tool-step and auxiliary requests.

## 1.0.7-local-stage-exceptions

- Added stage-aware exceptions for conversational and uncertain openings.
- A conversational ask-back becomes `Need your input`; cognitive assertions use `Need think`; uncertainty uses `Need confirm`; a third-person request opener uses `Need address the request:`.
- Negative imperatives use `Should not`; the copula uses `Should be`; the generic action verb `do` uses `We need do`.
- Quote and URL spans are protected; only prose at a clause boundary is rewritten.
- Expanded the verb whitelist while preserving each original verb.

## 1.0.6-local-bold-register

- Added `normalizeRegister: bold`, a more aggressive clause-start mode that keeps the original verb and only changes its form.
- Sentence-start action verbs become `We need <verb>`; verification verbs become `Need <verb>`; advisory verbs become `Should <verb>`.
- The legacy future first-person forms no longer survive: they become `Let's <verb>` (or `Should <verb>` for advisory verbs).
- Conjunction clauses use `and we need <verb>`; the legacy inclusive imperative becomes `let's`.
- Existing `need to` is shortened to `need` in bold mode.

## 1.0.5-local-register-history

- Replaced stale-assistant deletion with in-place sentence-initial register normalization.
- Rewrites the legacy sentence opener to "Let's" and sentence-initial singular first person to "We".
- Removes a leading hesitation word and capitalizes the next word.
- Keeps tool-call / tool-result pairing unchanged; only assistant text and reasoning channels are rewritten.
- The packaged host source, README, locale files, and tests no longer contain the full legacy opener or skill name.

## 1.0.0

减少雷霆大思考，调用工具积极，极大提升 DeepSeek-v4.1-flash 的能力。

- 极大提升 DeepSeek V4.1 Flash 的思维能力，极大减少“雷霆大思考”，调用工具积极，插件已接近于完全体。
- 会有长思考，但不是重复规划、无意义反思，也不会把各种日志等垃圾信息拉进自己的思维。
- 不遇到任务过重、需要反复探索本机状态、阅读 skill 的情况（例如许愿提示词），应均为 We need 模式：句首高频以 We need、We、Need、Let's 为主，少见 L3t me、I 开头。实测“做一个宇宙飞船模型，能够一键剖析零件查看，尾部有喷火的效果或者激光，拆分零件任务去完成，必须达到高质量，逼真效果，必须惊艳我，让我眼前一亮”这个提示词，运行十几分钟，会出现大面积的 l3t me，后期仍有较大优化空间。
- 欢迎使用各种长提示词测试（真实场景、自然风光场景、捏人脸等精细 3D 建模除外）。
- 模型匹配：同时包含 deepseek 与 flash 两个词，大小写不敏感。
- Assistant seed before the real user task (839 chars, content + reasoning_content).
- Task-scoped mirror of assistant reasoning into assistant content; OpenDesign falls back to reasoning_details.
- Tool-step content mirroring plus a 133-char short anchor when a tool step has no plan.
- Post-compaction seed re-anchors the latest assistant tool-call.
- register gate removed; no "L3t me" filter.
- Tool result messages (`role:"tool"`) are never rewritten.

## 0.7.7-local-register-gate

- Added deterministic `registerGate: off | skip | anchor` and `registerAnchor: reasoning | content | both`.
- Drift detection is rule-based: the plan starts with a legacy opener, a first-person pronoun, or a task-subject pattern, and contains none of the collective register markers.
- `skip` does not mirror drifted plans; `anchor` also prepends a short WeNeed anchor to the latest drifted tool-call.
- No model self-audit, no stale cleanup, no history deletion.
- Added unit and delegated-path tests for drift detection, skip, anchor, WeNeed plans, and wire shape.

## 0.7.6-local-compaction-seed

- Added `postCompactionSeed: off | reasoning | content | both` (default `off` in code; package patch enables `reasoning`).
- After a compaction checkpoint with no newer user task, inject the original 837 seed into the latest assistant tool-call; no duplicate seed after the checkpoint.
- Default channel is `reasoning_content`; `content`/`both` are test-only contract changes.
- Keeps replayState blocks aligned and respects `mirrorScope`.

## 0.7.5-local-task-scope

- Added `mirrorScope: task | all` (default `task`). Task scope starts after the last real user task; after compaction it never crosses the checkpoint.
- Mirror and tool-step anchor no longer rewrite assistant turns from previous tasks. `all` reproduces the global Qoder-style behavior.
- Added cross-task tests: old task assistant/tool-call stays untouched; current task assistant/tool-call is mirrored; compacted pre-checkpoint history is excluded.
- Updated the delegated-path test: an old-task assistant is not mirrored on a new task.

## 0.7.4-local-tool-anchor

- Added configurable `toolStepAnchor`: `off` (default), `reasoning`, `content`, or `both`.
- When the latest assistant tool-call turn has neither content nor reasoning, the anchor is inserted into the existing assistant turn; no new message and no tool-pair change.
- The anchor keeps `source.replayState.blocks` index-aligned, so reasoning signatures survive.
- This is the DSH counterpart of Qoder's `reseedLastAssistant` / `fillWorkBuddyEmptyToolPlan`.

## 0.7.3-local-mirror-scope

- Mirror now runs on every target request, not only when a seed is injected.
- Added opt-in `mirrorToolSteps`: tool-call assistant reasoning can be mirrored into content for A/B testing. Default remains off, so DSH tool-step content stays `""`.
- Delegated-path mirror no longer short-circuits before `prepareCall` when only assistant history needs mirroring.

## Unreleased

- Added reasoning→content mirroring for non-tool assistant turns. Tool-call assistant content remains empty; existing content is never overwritten. Mirror can be disabled with `mirror: false`.
- Added unit coverage for normal assistant, tool-call, existing-content, empty-reasoning, disabled, and delegated-provider paths.

## 0.7.1

- Removed the hard-coded `728/728` seed-length check. The plugin now injects the actual non-empty `seed.txt` content; leading BOM/whitespace is still trimmed.
- Model matching remains `DeepSeek + Flash` (`[deepseek, flash]`); Pro is intentionally not included yet.
- Updated package tests and README to remove the fixed-length assumption.

## 0.7.0

- Provider-agnostic release: no `interceptModels` route is required; matched requests are delegated back to the original provider adapter with the modified messages.
- Matching now uses the upstream model id only by default (`matchName: false`); display names are not read unless explicitly enabled.
- Added `ctx.llm.prepareCall` + `prepared.stream` delegation with a recursion guard.
- Added package-integrity checks for `seed.txt`, `cordis.patch.yml`, locales, README seed, and tarball file list.

## 0.6.0

- Renamed the project/package to `dsh-we-need-plugin` (DSH We Need Plugin); the hyphen separates We and need for readability.
- README now includes an optional System Prompt tail with the exact 728/728 seed.
- GitHub repository renamed to `Lichadai/dsh-we-need-plugin`.

## 0.5.0

- Renamed the project to `dsh-weneed-plugin` (DSH WeNeed Plugin).
- Added the Chinese-first README section on WeNeed as a thinking style, attention scattering, and the Qoder boundary.
- Added guidance on tool/workspace/skill overhead and delaying tool calls.
- GitHub repository renamed to `Lichadai/dsh-weneed-plugin`.

## 0.4.0

- Release package is interception-only: no extra `weneed-native` provider is registered.
- Default `targetRules` is now `[deepseek, flash]`.
- Removed test harness, request capture, `systemTail`, and local absolute paths from the release package.
- Added detailed README covering seed positions, provider routes, future model filters, DSH upgrades, privacy, and publishing.
- Added release tests, MIT license, security policy, and GitHub release workflow.

## 0.3.0

- Added provider-agnostic model matching for DeepSeek 4.1.
- Added provider-scoped `interceptModels` routes.
- Added BAICAI and OpenDesign interception examples.
- Added Kimi K3.1 and DeepSeek V4 Pro target-rule examples for local testing.
