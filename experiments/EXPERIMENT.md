# 3.2.0 最近输出 A/B/C 实验

> 实验版，未发布。默认 `cordis.patch.yml` = 3.0 行为（新杠杆默认关）。本目录是三组真实采纳对比的运行配置与设计说明。调试/验收走 `dsh-live-session-debug` skill（9230 inspector + session.v4.jsonl.zstd 解析）。

## 1. 共同杠杆（三组都开）

「改距离大模型最近的话」——按稳定字段名定位、追加/填充式、升版不坏：

- `nearestGuidance: both`：在最近一条 `assistant(tool_calls)` 的 **content**（仅空时填、绝不覆盖模型自身正文）与 **reasoning_content** 末尾填入干净集体引导 `NEAREST_GUIDANCE`（继续导向、let/need 为主、自然分布）。幂等、replayState 对齐、不新增消息、不拆 tool pair。
- `teamRegisterHint: true`：给 `send_message / spawn_teammate / subagent / subagent_fork` 的 **description** 末尾追加软性 register 指令——外发消息/任务是直接 speech，直接让它用集体语态写（非「提示：seed」）。只追加、不改名/参数/结构。

## 2. 两个变量与隔离

3.0 的「seed 注入」不止 `injectSeed` 一条路径，而是一个**bundle**：
- `injectSeed` 任务紧贴 seed（`seedInjection` 门控）；
- `toolStepReseed` 工具步重注入（`seedInjection && toolStepReseed` 门控）；
- `toolStepReasoning: anchor-seed` 把完整 SEED 追加进工具步 reasoning；
- `postCompactionSeed: reasoning` 压缩后注入 seed。

若把 `anchor-seed`/`postCompactionSeed` 当作常量保留，seed 会漏进 A/B，实验失效。因此把整个 seed bundle 作为 B↔C 的单一变量；A/B 一律 seed-free（`toolStepReasoning: anchor` 只留短锚、不含 seed；`postCompactionSeed: off`）。

| 配置键 | A | B | C | 说明 |
|---|---|---|---|---|
| `seedInjection` | false | false | **true** | seed bundle |
| `toolStepReasoning` | anchor | anchor | **anchor-seed** | seed bundle（anchor 部分恒定） |
| `postCompactionSeed` | off | off | **reasoning** | seed bundle |
| `toolStepReseed` | true | true | true | 恒定；被 seedInjection 门控，仅 C 生效 |
| `reorderContexts` | **false** | **true** | true | A↔B 唯一变量 |
| `nearestGuidance` | both | both | both | 共同杠杆 |
| `teamRegisterHint` | true | true | true | 共同杠杆 |
| `sanitizeProgram` | true | true | true | 恒定（3.0 标准清洗，非 you→we 改写） |
| `mirror` / `mirrorToolSteps` | false | false | false | 恒定 |
| `toolStepAnchor` | off | off | off | 恒定 |
| `mirrorScope` | task | task | task | 恒定 |
| `compactionRegister` | we-need | we-need | we-need | 恒定 |

- **A↔B 隔离「顺序移动」**：仅 `reorderContexts` false→true，其余全同（seed bundle 两组都关）。
- **B↔C 隔离「seed 注入」**：仅 seed bundle 关→开，`reorderContexts` 两组都 true，其余全同。
- **C = 完整 3.0 + 共同杠杆**。A = 无 seed/无移动 + 共同杠杆。B = 3.0 去 seed 留移动 + 共同杠杆。

> 注：`sanitizeProgram` 是 3.0 标准程序文本清洗（`PROGRAM_REPLACEMENTS`：Let me→We need、the user→the requester 等少量规划短语），**不是** 3.1.0 暂停的 you→we 大面积人称改写。它在三组恒定，不构成变量。

## 3. 运行步骤（dsh-live-session-debug）

前置：实验版装到 DSH profile（live 或隔离 profile），host 重启加载新代码。**安装/重启 = risky/shared，先与用户确认空闲窗口；绝不在一轮对话进行中重启。**

每组：
1. 把对应 `cordis.<X>.yml` 应用为插件配置，重启 host，等 ≥60s，`/health` 或 inspector 确认新 PID/版本。
2. 用 `scripts/open-session.mjs` 开一个唯一会话，固定 provider/model（`opendesign/deepseek-v4.1-flash`，effort max）、固定 cwd、固定多步任务（同一任务三组复用，单一变量）。
3. 用 `scripts/read-session.mjs` 读日志，记录：`toolCalls`、`toolResultChars`、`reasoningChars`、`letMe`、`iCount`、`letMePer10k`、首条 thinking 开头、最终答案。
4. 三组同任务、同 cwd、同模型；大日志委派只读 subagent 读（compact 表 + ≤3 短引用），主 agent 不重抓。
5. 比较**密度**与**首句/首个工具步开头**，不是绝对计数；meta-task 引用会抬高计数。每组至少两跑确认。

判读：
- 若 A≈B≈C 且 letMe 低 → 共同最近杠杆已够，reorder/seed 非必要（用户「完全没必要大动干戈」分支）。
- 若 B 明显优于 A → 顺序移动有效。
- 若 C 明显优于 B → seed 注入有效。
- 采纳 ≠ 注入：先看 wire/audit 确认 seed/引导命中，再看首句是否采用。

## 4. 离线实证（已完成）

- 6 套件绿：injection / features-2.1.0 / toolstep-reseed / signature-normalize / nearest-output-ab / package。
- 真实语料重放（tmp/replay-abc.mjs，88 工具）：A/B `injected=false`、C seed 紧贴 task；三组最近 content+reasoning 均有引导、Team 描述均有 hint；88 工具数量/名称/参数骨架逐字节不变。
- 待补：用本目录三份配置重放，确认 A/B 工具步 reasoning 无 SEED（只有 anchor+NEAREST_GUIDANCE）、C 有 SEED。

## 5. 状态

- 源码 + 离线：完成。未碰 live：未安装实验版、未重启 host、未发布。
- 待用户确认：live 安装/重启窗口 → 跑真实采纳 A/B/C。

## 6. 后续变体 D / E（2026-11-12 追加）

- **D** = C + `toolDescriptionSeed:all`（88 工具描述持久引导）。live 已跑：§114.9/114.10 全量评估判 **D≈C 不是质量胜利**（语态弱正向、质量未证、成本更差，+14608 字/请求添噪）。
- **E**（`cordis.E.yml`）= **仅字段引导，无 seed**：`seedInjection:false`、`toolStepReasoning:anchor`、`postCompactionSeed:off`；引导只走输出字段 `nearestGuidance:both`（最新 assistant 的 content+reasoning）+ 工具字段 `toolDescriptionSeed:all` + `teamRegisterHint:true`。`reorderContexts:true`。
  - **Team 英文交流格式已加回**：源里 `TEAM_REGISTER_HINT` 精修为 `"Write in English, in the collective planning voice: mostly Let's / Need / We need, with Should / Could / We can and ordinary sentences mixed in. Keep any quoted user task verbatim…"`；覆盖扩到 7 个外发 speech 工具（send_message / spawn_teammate / subagent / subagent_fork / team_task_create / team_task_update / remote_send_message）。
  - 离线验证全过：无 seed 注入、输出 content+reasoning 有引导、7 工具英文 team hint、8/8 工具 descSeed、read 不带 team hint。6 套件绿。
  - 注意：E 首轮无 seed 偏置（nearestGuidance 首轮 no-op），首句语态全靠模型 + 工具描述 hint，预期首轮漂移概率高（同 A）。E 测的是「纯字段引导」上限，不是首句强制。
  - `toolDescriptionSeed:all` 若要去噪改 `off` 一行即可。
  - **未装 live**；安装需 reinstall（含精修 hint 的源）+ 应用 cordis.E.yml + 完整重启，待用户空闲窗口确认。