# 4.4.4 发布说明（2026-11-28）

## 本版内容

### 1. 开工后冻结缓存前缀

4.4.3 的 `orderContextsBeforeAllTasks()` 会把每个 task 段内所有 context 前移到 task 前。它修好了续接首请求，但把任务开工后新追加的 `time-context`、runtime context、进度提示也前移了。

真实会话 step 11：

- 宿主追加 `time-context`：`Elapsed since the preceding step context: 11m 8s.`
- 4.4.3 把它移到原 task 前。
- task 及其后约 137k 历史整体右移。
- 输入 154,132，`cacheRead` 仅 17,024，单步命中 11.05%。

4.4.4 改为 `orderContextsBeforeFirstResponse()`：

- 每个 task 段只前移“task 之后、第一条 assistant/tool 之前”的初始 context。
- 第一条 assistant/tool 之后的新 context 保持宿主追加位置。
- seed 仍紧贴真实 task；compaction checkpoint 仍是硬边界。
- 旧函数 `orderContextsBeforeAllTasks` 仅保留导出用于对照，不进入 live 请求路径。

### 2. 思维链承重件不动

- `seed.txt` 的 Kimi 原文不改。
- 合成 seed 的 `content` / `reasoning_content` 仍为同一份全量块。
- `normalizeReasoningChannelMessages` 仍覆盖全部历史 assistant。
- `contentFillScope: task`、`toolStepSeedPlacement: assistant`、`toolStepReasoning: anchor-seed`、`toolStepReseed: true` 不变。
- 所有旧 assistant 的 reasoning 文本、tool call/result 配对、旧 task 内容均不改。

### 3. 测试与 live

- 新增 `tests/ordering-444.test.mjs`：
  - step 11 式 late time-context 保持尾部；
  - 续接时旧前缀冻结；
  - 初始 context 仍前移；
  - compaction 边界；
  - seed 双通道与原文。
- 原有 13 套件 + 新套件共 14 套全绿。
- live 已安装并重启，audit `v=4.4.4`，`seedHash=70de6dc3b9446929` 未变。
- live smoke `dsh-444-cache-01`：18 步、`letMe=0`、`iCount=1`、`result.md=175`，末步命中 99.21%。

## 产物指纹

- `index.js`：94,251 B，SHA-256 `8a3f7403d47eb47734f2bdfee156969f575ab414d5897e62a186cd45b909fae4`
- `dsh-we-need-plugin-4.4.4.tgz`：63,367 B，12 文件
  - SHA-256：`8c3f9d447c098c04c21c6256198fca3802b6eb1f308b7480517d8045eb193ead`
  - integrity：`sha512-j3aLQ9d1Nx3eq0ZATFlhQUxarut7zz2CwUfQGr3w5KjiVptKvNS7Na68t5YAi1RbBhmds/jl1D1C+uW7qXidjA==`

## 回滚

- live 4.4.3 备份：`backups/live-4.4.3-before-4.4.4-20261128-1735/`
- 旧源码：`releases/4.4.3-cache-order-20261128-src/`
- 旧 tgz：`releases/local/dsh-we-need-plugin-4.4.3.tgz`

## 已知限制

- 真实 4.4.4 会话 step 16 已触发 late `time-context`：输入 132,148，`cacheRead=118,144`，单步命中 89.40%，上一步前缀复用 98.5%；同一任务 4.4.3 step 11 为 17,024 / 154,132 = 11.05%。
- 该会话累计命中 83.72%；按复用上一步完整输入的理论上限约 88.02%，差额来自 step 2 冷启动 0 命中、大输出和局部 provider 波动，不是 137k 前缀坍塌。
- 大输出步骤的原始命中率仍会下降，这是输出首次进入下一步输入的正常成本，不应与本修复的异常前缀失效混为一谈。
- live smoke 中带 `todo_write` 的工具步仍有局部前缀复用波动（未见 137k 级坍塌），本轮未把它归因或纳入修复范围。