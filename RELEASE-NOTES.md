# DSH We Need Plugin 4.1.0

> 稳定的 We Need 思维链，极大提升 DeepSeek V4.1 Flash 的能力。

## 4.1.0 的重点

4.1.0 是一次 **TeamAgent 外发升级**，同时保留 live 4.0.1 的 content 保留修复和 882 seed。

### 1. TeamAgent 外发范围

旧的 Team hint 只写 “Every message or task sent to a teammate”，实际容易漏掉 sub-agent 和 workflow 里的 agent prompt。

4.1.0 改为：

- 明确覆盖 **teammate、sub-agent、workflow agent(prompt)**；
- `TEAM_HINT_TOOLS` 从 7 个增加到 8 个，新增 `workflow`；
- 原有 `send_message / spawn_teammate / subagent / subagent_fork / team_task_create / team_task_update / remote_send_message` 继续覆盖；
- 只追加 tool description，不改工具名、参数、结构、`tool_choice` 或消息；
- 外发语态仍是 `Need / Should / Could / Can / Must / May` + `We need / We should / We can / Let's` 的语义分工与句式混合。

### 2. 保留 4.0.1 的 content 修复

带 `tool_calls` 的 assistant 消息默认保留已有 `content`（包括旧 mirror、seed、tool-step anchor 留下的 text）；只有显式 `stripToolCallContent: true` 才执行旧版清理。`wireMessage()` 不再丢弃已有 text。

### 3. 保留的配置

- seed：882 字符 / 883 字节，SHA `901a2ed2…`；
- `toolStepReseed: true`；
- `postCompactionSeed: reasoning`；
- `compactionRegister: we-need`；
- `nearestGuidance: both`；
- `teamRegisterHint: true`；
- `mirror: false` / `mirrorToolSteps: false`；
- `stripToolCallContent: false`；
- `toolResultSeed: off` / `toolDescriptionSeed: off`。

## 支持的模式

- **标准模式**：支持（基线）。
- **goal 模式**：支持（goal-only 会话也注入 seed）。
- **Team Agent 会话**：支持；team / agent / subagent 消息按上下文处理，seed 仍注入真实任务；Team 外发覆盖 teammate / sub-agent / workflow。
- **Response API（openai-responses）**：签名处理支持；完整 live 验证待补。
- 其他模式：未验证。

## 安装

```text
https://github.com/Lichadai/dsh-we-need-plugin/releases/download/v4.1.0/dsh-we-need-plugin-4.1.0.tgz
```

## 校验

- 文件：`dsh-we-need-plugin-4.1.0.tgz`
- 大小：`50344` 字节
- SHA256：`ea02cf6b8b2c2f6c7bff64143b5b5342e9e3b8b03fbf7657bef7524fb83aefea`
- `index.js` SHA256：`c154bb5d5fa2679d4164b4cca3a290f50ad1032804c32e2e8ada2946f66c9e8e`
- `seed.txt` SHA256：`94499d6f7d6572bcf2a8e7a8fc46d6e2b209267d4eef65fa37ad929620205b6f`
- 包内文件数：12

## 历史

v4.0.0 / v3.0.0 / v2.2.0 / v2.1.0 继续保留为历史版本。4.1.0 是当前发布版。
