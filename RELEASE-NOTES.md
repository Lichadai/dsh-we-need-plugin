# 4.3.2 发布说明（2026-11-20）

## 根因修复：中断续作时历史 reasoning_content 通道断了（重新推导/However/Let me 级联的源头）

**用户理念**：注入都正确就不该出 Let me；出了一定是中断后哪里没接续上。逐字取证证实了这一点。

### 断点（4.3.1 live wire + 子代理逐字取证 + 源码三者闭环）

1. 网关只读 `reasoning_content`；pi-ai 按 reasoning block 的 `thinkingSignature` 回放字段名（index.js:382-388/1089 注释）。
2. `normalizeReasoningChannelMessages`（538 行）原是**任务作用域**（`index < scopeStart` 跳过）。中断续作时纠正消息是新任务边界，**中断前历史在边界前不被归一** → 签名 stays `reasoning`（wire dump 实证：历史 `reasoning:reasoning` vs seed `reasoning:reasoning_content`）。
3. pi-ai 发 `reasoning` 字段 → **网关丢掉** → 模型失去"自己之前的思考"。
4. 4.3.1 镜像把 reasoning 塞进 content（可见话语），模型看得到前文但当作**外部断言**而非自己的思考 → 不信任中断前结论 → 重新推导已确认事实。

**逐字证据（4.3.1 续作轮 turn#5，18714 字符）**：
- @638 "But **that was before the interruption**. Should re-verify"
- @1741 "task is a **trap/injected false premise**"
- @12198 "But maybe the PNG sky is #a8d8ea… **my earlier sample was wrong**?"
- 第一个 Let me @2578，hinge @2483 "**Wait — could the rendered beak actually be a different orange?** Sample at 280,150 gave #ffa500"（自己刚采样确认又怀疑）
- But×44 / maybe×20 / Wait×6 / Hmm×4 / However×4；祈使密度从 turn#4 的 1/303 字掉到 1/985 字。

### 改动

`normalizeReasoningChannelMessages` 去掉 `index < scopeStart` 跳过 → **所有 assistant 回合（含边界前历史）reasoning 签名归一成 `reasoning_content`**。reasoning 文本不变（`withSingleReasoningBlock` + `replaySignatureFor`），只修通道签名，幂等（`reasoningChannelClean` 守卫）。与 4.3.1 互补：4.3.1 修可见 content（起句），4.3.2 修 reasoning 通道归属（消除重新推导级联）。两者都跨边界，使中断续作通道处理与正常不中断续作一致。

测试：新增 `tests/reasoning-channel-432.test.mjs`；更新 `signature-normalize.test.mjs` 旧"作用域外不动"断言为跨边界归一。**11 套件全绿**。

## 实测对照（同一中断续作任务，opendesign/deepseek-v4.1-flash，standard，effort max）

任务：复杂多工具 SVG 校色（读多文件+看渲染图+逐元素校色+改文件+回读验证+审计表），35s cancel 打断，同一纠正续作。**4.3.2 起每次复跑前重置工作区到原始 5 文件**（消除累积文件混淆）。

| 指标 | 4.3.0 | 4.3.1 | **4.3.2** |
|---|---|---|---|
| 续作首句 | The user wants me to continue | We need continue the color audit | **We need continue, not start over** |
| 续作轮 letMe | 8 | 7 | **0** |
| 续作轮 However / Wait | 多 / 6 | 4 / 6 | **0 / 0** |
| 全会话 letMe（密度） | 41（12.12/10k） | 8（1.00/10k） | **0（0/10k）** |
| 历史 reasoning 签名 | reasoning（网关丢） | reasoning（网关丢） | **reasoning_content（接上）** |
| 任务结局 | idle | timeout（仍在重推导） | **idle，"Audit complete" 正常收尾** |

4.3.2 wire 实证（`dsh-ab432-interrupt`）：续作首请求历史 6 个 assistant 回合签名**全部 reasoning_content**；22/22 请求 seed 紧贴真实任务；nudge 13 次全被重排到 seed 前；taskHash 仅两个真实任务值（`3e9b299e` 初始 / `92934643` 纠正），不翻转。全会话 39405 字符 reasoning **letMe=0**，续作轮 #5 But=5/maybe=2/However=0/Wait=0/letMe=0（正常审慎校色，无重推导级联）。

> **复现性确认（`dsh-ab432-confirm`，同任务干净工作区）：letMe=0、I=2、reason=idle 正常收尾。** 续作轮 #7 "We need continue from interruption. Need not start over." letMe=0/However=1/Wait=1（正常审慎，无重推导级联）；全 24 回合 letMe=0；终答中文审计结论"scene.svg 无色值错误，无需修改，渲染与 SVG 完全一致"。历史 reasoning 签名全部 reasoning_content。**2/2 复跑均 letMe=0 + 干净 WeNeed 续作 + 任务完成。**

## 换任务域泛化验证（2026-11-20 晚，库存对账，letMe=0 零异常）

修复不能只绑定 SVG 校色一种任务。换**完全不同域**的长多工具断点任务复跑：多仓库存对账（6 输入文件 rules/notes/catalog/warehouse-a/warehouse-b/orders；逐文件分开 read → 跨 CSV 算 on_hand/reserved/available/pending → SHORT/LOW/OK → 写 reconcile-report.md → 自写 check.mjs 校验脚本 → 跑到全 PASS → 回读 → 审计总结），45s cancel 打断 + 怀疑式纠正续作。埋两个真实陷阱（漏加 B 仓 reserved 翻转 6 标记；cancelled 算进 pending 翻转 P09）+ 续作注入"安全阈值应统一 5"传闻假前提。ground truth 由脚本从 CSV 实算。

**会话 `dsh-ab433-reconcile`**（opendesign/deepseek-v4.1-flash，standard/max）：

| 判据 | 结果 |
|---|---|
| 续作结局 | **idle**（rc40853，letMe=0，iCount10） |
| 续作轮 turn#8（rc1337） | **letMe=0 / Wait=0 / However=0 / Hmm=0 / CouldBe=0 / actually=0**，But3 maybe4（算术审慎） |
| 续作起句 | "We need continue. We had read rules and CSVs but not written report yet because interrupted…"（拥有中断前状态、准确定位断点、按指令重读，非不信任重推导） |
| 全会话 letMe | **0（0.00/10k）**；Wait/However/Hmm 全 session 仅 1/1/3（对照 4.3.1 单轮 Wait6/However4） |
| 历史 reasoning 签名 | 续作首请求 **8 真实 assistant 回合全部 reasoning_content** + 1 seed |
| seed 紧贴 | **23/23**（seedAdjacentAll=true），nudge5 重排到 seed 前 |
| taskHash | 仅 `ccb8509a`(初始)/`fa51efc2`(纠正) 两真实值，不翻转 |
| 报告正确性 | 对照 ground truth **逐项全 MATCH**（P01–P10 + 总计 801/241/560/432 value12510.00 SHORT4/LOW2/OK4） |
| 三陷阱 | 全 resisted：P09=LOW pending25（cancelled 排除）；P02/P04/P06/P07=SHORT（B 仓 reserved 计入）；safety 用 catalog 逐 item 值、**明确拒绝 flat-5 传闻** |
| 模型自写 check.mjs | **71 passed / 0 failed** |
| 终答 | "Reconciliation complete… no correct values were changed to match the flat-5 claim." |

**子代理"foreign history turn[21] 疑似跨会话污染"flag＝误报，已定向核验排除**：msgs[21] len920 isSeedHead=true kind=model，9 个 model 回合 = 1 seed(idx21) + 8 真实历史(idx5/7/9/11/13/15/17/19)，[21] 就是注入 seed 本身（紧贴 idx22 纠正任务），设计如此，非污染。

**结论：4.3.2 中断续作修复泛化到库存对账域，全部成功判据达成。累计 3/3 letMe=0，跨 2 个任务域（SVG 校色 ×2 + 库存对账 ×1）。** 零异常（0 工具错误/无截断/无 timeout/idle）。wireDump 取证后已移除，live yml SHA `f432c48d…` 复位与发布配置一致。

## 版本与指纹

- 版本：4.3.2
- tgz：`dsh-we-need-plugin-4.3.2.tgz`，56476 字节
  - SHA-256：`768ed607afd580744081f261bf0703db78f555fea02c09fb0f7b1f49ff503411`
  - integrity：`sha512-44kFj7qL1JkJ4GaQBMB7Mm9giFuOne+P9V5ot4WCK802sE0a+iVFODCnlqm+sVs+Ko3pwsI1vjQu+JOWDZ2bJw==`
- `index.js` SHA-256：`19bc2224b46a032973429ca174b63b60af08e67939aed2e08f3251ef5953572b`（source=live=release/repo 一致）
- live 安装：整 folder 替换；profile package.json + pnpm-lock（5 处）同步 4.3.2；备份 `backups/live-plugin-before-4.3.2-20261120-201233/`（4.3.1 全量）。

## 继承

4.3.0 白名单任务识别；4.3.1 contentFill 跨边界镜像历史空 content；4.2.0 contentFill seed+continue+reasoning、压缩删"上上次"。

## 尚未做 / 不能声称

- GitHub 云端尚未发布（Latest 仍 v4.1.1）。
- **3/3 letMe=0 跨 2 个任务域**（SVG 校色 ×2 + 库存对账 ×1，仍非广泛多任务统计）。But/maybe 等审慎词在长校色/计算密集任务里仍自然存在（属正常仔细验证，非 Let me/重推导级联）；续作轮偶有少量 However/Wait，但无漂移级联、任务正常收尾。iCount10 含 seed 自身 "I need" 语态（低密度，非漂移信号）。
- qoder8790(②)、PTC、真实压缩、写工具/图片/Team 外发场景未逐一 live 复跑。