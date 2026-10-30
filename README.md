# AI 工具推荐助手（桌面 Agent）

用一句话说出想实现的功能，Agent 按内置的「AI 工具选型专家」Skill 去国内渠道调研，核实官网后输出 6 列对比表（工具/智能体、类型、能否满足、是否免费、能否接入、结论）；没有完全满足的工具时给出“现成工具 + 自研”的实施方案。全程只用国内大模型和国内搜索接口，不依赖 ChatGPT、Claude、Codex 等海外服务。

## 直接使用（Windows）

1. 解压 `AI工具推荐助手-0.1.0-x64.zip`，双击 `AI工具推荐助手.exe`。程序没有签名，首次打开如果出现 SmartScreen 提示，点“更多信息 → 仍要运行”。
2. 左下角「设置」里填两个 Key，点“测试连接”，两行都显示已连通后保存：
   - 大模型：默认通义千问（阿里云百炼，`qwen-plus`），可切换 DeepSeek、智谱 GLM、Kimi、豆包，或填任意 OpenAI 兼容接口。每个服务商旁边有“去申请”链接。豆包的模型名要填火山方舟里的模型 ID 或接入点 ID。
   - 联网搜索：博查 Web Search（默认）或智谱 Web Search。
3. 在首页输入需求，或点两个测试案例卡片。调研过程（每次搜索、打开的网页、成败）实时显示，结束后输出报告，可导出 Excel（对比表带超链接）、Word、Markdown。
4. 报告出来后可以继续追问，例如“只看免费的”“展开第 2 个工具”，追问基于已有报告回答，不重新全量检索。

数据都在本机：配置和历史记录在 `%APPDATA%\ai-tool-scout-desktop\`，API Key 用 Windows 系统加密保存。

## 功能

| 功能 | 状态 |
|---|---|
| 内置专家 Skill 作为系统提示词（`skill/SKILL.md` 整份加载） | 已完成 |
| 需求解析与一次追问澄清、多渠道检索、官网核实、满足度判定、实施方案、固定模板报告 | 由 Skill 规定流程，模型通过函数调用自主执行 |
| 工具：`web_search`（可限定站点）、`fetch_page`（抽取网页正文，10 秒超时）、`read_reference`（读取 Skill 附带案例） | 已完成 |
| 工具调用预算（默认 30 次，用完强制出报告）、停止按钮、失败重试 | 已完成 |
| 导出 Excel / Word / Markdown | 已完成 |
| 追问与细化 | 已完成 |
| 历史记录（侧栏，可删除） | 已完成 |
| 浅色 / 深色 / 跟随系统，可折叠侧栏（missly 风格） | 已完成 |
| 本地工具库缓存（规格中的 P2） | 未做 |

### 调整专家 Skill 不用重新打包

在数据目录下新建 `skill\SKILL.md`（即 `%APPDATA%\ai-tool-scout-desktop\skill\SKILL.md`），重启程序后会优先使用它，`examples\` 也可以一起放进去。删除该文件即恢复内置版本。

## 开发

需要 Node.js 20 以上。

```bash
npm install          # 国内网络可先设置 ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
npm start            # 开发运行
npm test             # 离线测试：Agent 循环、工具、导出（用模拟的模型和搜索接口）
xvfb-run node test/e2e.js shots/   # 端到端：启动应用跑一次模拟调研并截图（Linux 无界面环境）
npm run dist:win     # 在 Windows 上打安装版 + 免安装 zip
```

在 Linux 上打 Windows 包只能出 zip（安装版需要 wine）：`npx electron-builder --win zip --x64`。

### 目录

```
main.js            主进程：窗口、IPC、导出、历史记录
preload.js         渲染进程可用的接口（window.scout）
src/agent.js       Agent 循环：Skill → 系统提示词，函数调用，工具预算
src/tools.js       web_search（博查 / 智谱）、fetch_page、read_reference
src/config.js      模型与搜索预设、配置读写（Key 加密）
src/export.js      Markdown 报告 → Word / Excel
renderer/          界面（原生 HTML/CSS/JS，无框架）
skill/             内置的 ai-tool-scout 专家 Skill
test/              模拟接口、单元测试、端到端截图脚本
```

## 已知限制

- 开发环境无法访问国内模型和搜索接口，目前只用模拟接口跑通了完整流程，还没有用真实 Key 跑过两个测试案例。第一次真实运行时请留意：模型名是否仍有效、搜索结果数量、个别官网是否能抓到正文（前端渲染的页面正文会很少，Agent 会改用搜索摘要并在报告里注明）。
- 程序未签名，也没有自定义图标。
