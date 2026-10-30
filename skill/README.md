# ai-tool-scout：AI 工具选型专家 Skill

用一句话描述想实现的功能，它会联网调研市面上现成的智能体和 AI 工具，输出 6 列对比表（工具/智能体、类型、能否满足、是否免费、能否接入、结论）。没有完全满足的工具时，会给出“现成工具 + 自研”的实施方案。推荐时国内可用优先。

## 文件结构

```
ai-tool-scout/
  SKILL.md                                  技能本体（角色、规则、6 步流程、渠道表、判定规则、输出模板）
  README.md                                 本说明
  examples/case1-xiaohongshu-video.md       测试案例 1：期望拆解与检查点
  examples/case2-sheet-anomaly-alert.md     测试案例 2：期望拆解与检查点
```

## 安装

SKILL.md 采用通用的 Agent Skills 格式（YAML 头部包含 name 和 description，正文为说明）。把整个 `ai-tool-scout` 文件夹放进对应工具的 skills 目录即可。

| 工具 | 放置位置 |
|---|---|
| Codex | `~/.codex/skills/ai-tool-scout/` |
| Claude Code | `~/.claude/skills/ai-tool-scout/`（个人）或项目内 `.claude/skills/ai-tool-scout/` |
| 其他支持 SKILL.md 的 Agent | 放进该工具的 skills 目录 |
| 不支持 Skill 的工具（如工作流平台的 LLM 节点、国内大模型对话） | 把 SKILL.md 正文（`---` 之后的部分）整段粘贴到系统提示词 |

目录位置以你所用版本的官方文档为准。安装后重启工具，让它重新加载技能。

## 使用前提

- 必须开启联网搜索或网页浏览能力。没有联网时，技能会直接说明无法检索，不会凭记忆给出推荐。
- 推荐国内用户使用带联网能力的国内模型，例如开启联网搜索的通义千问或 Kimi。

## 使用示例

直接提问即可，例如：

- 我想要一个能自动把文字转成小红书视频的智能体。
- 我想要一个能自动监控表格数据异常并提醒的智能体。

在 Codex 或 Claude Code 中，可以先说“用 ai-tool-scout 技能帮我调研：……”，确保触发这个技能。
