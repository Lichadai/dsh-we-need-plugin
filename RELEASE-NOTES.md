# 4.4.1 发布说明（2026-11-24）

## 本版内容

### 1. `seedOrientation` full 的模式内顺序

`full` 模式现在按“当前状态优先”组织定向块：

```text
todo
上下文占用
标注 + raw seed
上一步 reasoning
continue
```

真实 task 紧贴 seed。首轮没有 todo、usage 或 previous 时，退化为：

```text
标注
seed
continue
```

缺省数据一律省略，不编造。`example` 模式仍只有标注 + seed + continue。关闭（`off`）时与 4.3.2 行为一致。

### 2. todo 源：投影优先 + 历史兜底

`full` 优先读宿主当前 `todos` 投影（`ctx.sessionProjections.stateOf(session, 'todos')`，工具步期间 populated、last-write-wins、抗压缩）；轮次开头投影清空时，退回历史最近一次 `todo_write` 的整表。审计增加 `orientationTodosSource: projection | history | none`。

### 3. 文档与元数据同步

- `package.json` 版本和描述更新到 4.4.1；
- `CHANGELOG.md` 补充顺序改动；
- README 顶部更新到 4.4.1，并标注 882 seed 段落已过时；
- locale 描述更新；
- 发布树重新组装为完整仓库：运行文件 + `tests/` + `.github/workflows/release.yml` + `bin/` + `PUBLISHING.md`。

## 默认值

- 发布包默认 `seedOrientation: off`，不改变既有安装行为；
- `full` 是显式 opt-in；
- 发布包和发布树不含 `wireDump`，不包含 live 取证配置；
- 12 个 npm 打包文件，tests / CI / bin 只进仓库树，不进 tgz。

## live 顺序实验（同一 prompt，2 次旧顺序 + 2 次新顺序）

环境：DSH Desktop，PTC preset，provider/model `cyou/deepseek-v4.1-flash-1017`，effort `max`，同一最小 todo/read/write 任务。

| 指标 | 旧顺序 | 新顺序 |
|---|---:|---:|
| wire 请求数 | 13 | 12 |
| 目标顺序严格通过 | 2/13（仅首轮缺段） | **12/12** |
| 工具步满足新顺序 | 0/11 | **10/10** |
| seed 紧贴真实 task | 13/13 | **12/12** |
| seed reasoning 为 920 字 raw | 13/13 | **12/12** |
| tool-call / result 配对 | 13/13 | **12/12** |
| 空 tool content | 0 | 0 |

- 旧顺序：`label → seed → previous → todo → usage → continue`
- 新顺序：`todo → usage → label → seed → previous → continue`
- 首轮无 todo/usage/previous 时，四跑都退化为 `label + seed + continue`。
- 四跑首条 reasoning 均以 `We need` 开头，任务结果均为 90，均无问候回声。
- Let me：旧顺序 0 和 1（1.59/10k），新顺序 0 和 0。
- 新顺序两跑的首次 reasoning 直接点名测试路径，旧顺序两跑没有。

**边界**：只有 2+2 个单任务样本，不能据此宣布因果或广泛稳定性；完整 A/B（example/full、长任务、真实压缩、中断续作）尚未做。live 实验时另开了 `full`，发布包默认仍是 `off`。

## 产物指纹

- `index.js`：87624 B，SHA-256 `e940530ee1c0b03d0e6db9b08910826578602454588966d6dd47ce9eba2c626e`
- `dsh-we-need-plugin-4.4.1.tgz`：60219 B，12 文件
  - SHA-256：`e9fd679cab92a7cc6daad2525de2d271f35065a442f8fc7fa1b66deb9e9acba6`
  - integrity：`sha512-bw7QAJD0kzMGjcpyPs6oB8ixgbFtbcpDgtP5ystE7jbThqwC/XNq5honCgReG3mSQv/FRr8i5ZfgWSQVpGTkOQ==`
- 两次本地 `npm pack` 字节一致；测试 **12/12 套件全绿**。

## 安装

从 GitHub Release 下载 tgz，在 DSH 的插件安装界面选择本地文件，或在 profile 中把依赖指向该 tgz。不要把 tgz 解包后逐文件覆盖运行目录。

## 已知限制

- 本版发布的是门控能力，默认 `off`；需要定向块时自行设 `seedOrientation: full`。
- 小样本 live 对照只覆盖一个最小任务与一个 provider 路由。
- 未做长任务、真实压缩、中断续作、Team/Image 场景的本版专项回归。
- `full` 的 todo/usage 依赖宿主服务；取不到时按设计省略对应节，不会阻断注入。