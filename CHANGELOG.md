# Changelog

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
