// 模拟 OpenAI 兼容模型接口 + 博查搜索接口 + 一个网页，用来离线跑通 Agent 流程。
const http = require('http');

const REPORT = `## 结论
没有完全满足的现成工具。首推 [示例成片](http://HOST/page)，它覆盖文案到成片，但不支持自动发布到小红书；建议“示例成片 + 人工发布”。

## 需求拆解
- 核心功能：把一段文字自动做成适合小红书发布的短视频
- 子功能：1. 文案改写 2. 分镜配图 3. AI 配音 4. 字幕剪辑 5. 竖屏导出 6. 发布到小红书
- 约束：优先免费，国内可用

## 工具对比
| 工具/智能体 | 类型 | 能否满足 | 是否免费 | 能否接入 | 结论 |
|---|---|---|---|---|---|
| [示例成片](http://HOST/page) | SaaS 工具 | 部分满足（缺：发布到小红书） | 有免费额度（每月 10 条） | 开放 API；国内可用 | 推荐用于成片环节 |
| [示例智能体](http://HOST/page) | 智能体 | 部分满足（缺：AI 配音、发布） | 免费 | 插件；国内可用 | 推荐用于文案改写 |

## 实施方案
1. **分工表**：文案用示例智能体，成片用示例成片，发布人工完成。
2. **组合方式**：扣子工作流串联。
3. **落地步骤**：注册账号（0.5 小时）→ 搭工作流（2 小时）→ 试跑（1 小时）。
4. **成本与风险**：免费额度用完后按条计费。

## 参考来源
- http://HOST/page`;

function start(port = 0) {
  const log = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      const host = req.headers.host;
      const json = (o) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
      if (req.url.endsWith('/chat/completions')) {
        const b = JSON.parse(body);
        log.push(b);
        const toolMsgs = b.messages.filter(m => m.role === 'tool').length;
        const isFirstTurn = b.messages.filter(m => m.role === 'user').length === 1;
        let message;
        if (!b.tools) message = { role: 'assistant', content: '好' };
        else if (!isFirstTurn) message = { role: 'assistant', content: '只看免费的：\n\n| 工具/智能体 | 类型 | 能否满足 | 是否免费 | 能否接入 | 结论 |\n|---|---|---|---|---|---|\n| 示例智能体 | 智能体 | 部分满足 | 免费 | 插件；国内可用 | 推荐 |' };
        else if (toolMsgs === 0) message = { role: 'assistant', content: '先按子功能检索智能体商店和导航站。', tool_calls: [
          { id: 'c1', type: 'function', function: { name: 'web_search', arguments: JSON.stringify({ query: '文字转视频 智能体', site: 'coze.cn' }) } },
          { id: 'c2', type: 'function', function: { name: 'web_search', arguments: JSON.stringify({ query: '图文成片 AI 工具 免费' }) } },
        ] };
        else if (toolMsgs === 2) message = { role: 'assistant', content: null, tool_calls: [
          { id: 'c3', type: 'function', function: { name: 'fetch_page', arguments: JSON.stringify({ url: `http://${host}/page` }) } },
          { id: 'c4', type: 'function', function: { name: 'fetch_page', arguments: JSON.stringify({ url: `http://${host}/404` }) } },
        ] };
        else message = { role: 'assistant', content: REPORT.replaceAll('HOST', host) };
        setTimeout(() => json({ id: 'x', model: b.model, choices: [{ index: 0, message, finish_reason: message.tool_calls ? 'tool_calls' : 'stop' }] }), 400);
      } else if (req.url === '/search') {
        const b = JSON.parse(body);
        log.push({ search: b });
        setTimeout(() => json({ code: 200, data: { webPages: { value: [
          { name: '示例成片 - 图文一键成片', url: `http://${host}/page`, summary: '输入文字自动生成竖屏短视频', siteName: '示例' },
          { name: '示例智能体', url: `http://${host}/page`, snippet: '小红书文案改写', siteName: '扣子' },
        ] } } }), 600);
      } else if (req.url === '/page') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=gbk' });
        res.end(Buffer.from('<html><head><title>Example</title><meta name="description" content="demo"></head><body><script>x()</script><h1>Example</h1><p>Free plan available</p></body></html>'));
      } else { res.writeHead(404); res.end('not found'); }
    });
  });
  return new Promise(r => server.listen(port, '127.0.0.1', () => r({ server, port: server.address().port, log })));
}

module.exports = { start };
if (require.main === module) start(+process.argv[2] || 8787).then(({ port }) => console.log('mock on', port));
