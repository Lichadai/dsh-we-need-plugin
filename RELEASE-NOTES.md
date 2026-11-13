# DSH We Need Plugin 4.0.0

> 稳定的 We Need 思维链，极大提升 DeepSeek V4.1 Flash 的能力。

## 4.0.0 的重点

4.0.0 把两件事一起定下来：**seed 继续仿 Kimi K3.1 Pro 的完整决策轨迹**，同时把 **Team 外发消息**从“纯祈使流程”改成有语义分工、有句式变化的规划语态。

### 1. Kimi 决策型 seed

seed 保留完整决策链，而不是只保留几个 `Need / Should` 词：

```text
任务复述 → 约束 → 候选 A/B → 风险检查 → 选定 → 祈使收尾
```

它能把这套思考顺序带到当前 task 紧前，对 DeepSeek V4.1 Flash 的规划连续性、任务分解和执行推进更友好。当前 seed 为 882 字符 / 883 字节，trim 后 SHA `901a2ed2…`，文件 SHA `94499d6f…`。

### 2. Team 外发语态

主 Agent 的 reasoning 里本来就有 `Need / Could / Let's / maybe / but` 的丰富规划语法；旧版 Team 提示词要求“每句以情态词开头”，实际外发消息却退化成 `Do / If / Use / Read / Keep` 的流程说明书。

4.0.0 改为：

- `Need` = 必需下一动作
- `Should` = 质量 / 约束
- `Could` / `Can` = 选项 / 能力
- `Must` = 硬限制
- `Let's` / `We can` = 共同下一步
- 允许普通陈述句和直接祈使句参与，不再要求每句同一个开头
- 长消息至少两个不同情态开头 + 一个普通句

推荐提示词示例：

```text
Need 读取当前项目要求和验收项。Should 先写计划并列出证据。Could 先做一个最小样件验证关键结构。Must 保留用户原话、路径和数值不变。Let's 用真实渲染图复核后再扩展。
```

这不是词表堆砌：`Need / Should / Could / Must / Let's` 各自承担不同的规划动作，句子也可以有普通陈述和直接命令。

## 支持的模式

- **标准模式**：支持（基线）。
- **goal 模式**：支持（goal-only 会话也注入 seed）。
- **Team Agent 会话**：支持；team / agent / subagent 消息按上下文处理，seed 仍注入真实任务；Team 外发语态按 4.0.0 规则。
- **Response API（openai-responses）**：签名处理支持；完整 live 验证待补。
- 其他模式：未验证。

## 安装

```text
https://github.com/Lichadai/dsh-we-need-plugin/releases/download/v4.0.0/dsh-we-need-plugin-4.0.0.tgz
```

## 校验

- 文件：`dsh-we-need-plugin-4.0.0.tgz`
- 大小：`49219` 字节
- SHA256：`4663672528439ea767f4829aea2a21d3c50360ff5d4c6bbfe8dc4b70ed3c3d82`
- `index.js` SHA256：`3078f56639830856c6db1545a4431bb1d1cb362242050bd6e1a971501d07a8d8`
- `seed.txt` SHA256：`94499d6f7d6572bcf2a8e7a8fc46d6e2b209267d4eef65fa37ad929620205b6f`
- 包内文件数：12

## 历史

v3.0.0 / v2.2.0 / v2.1.0 继续保留为历史版本。4.0.0 是当前发布版。
