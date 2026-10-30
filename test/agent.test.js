// 离线测试：Agent 循环 + 工具 + 导出。运行：node test/agent.test.js
const assert = require('assert');
const path = require('path');
const { start } = require('./mock-server');
const { runTurn, systemPrompt } = require('../src/agent');
const { toDocx, toXlsx } = require('../src/export');
const ExcelJS = require('exceljs');

(async () => {
  const { server, port, log } = await start();
  const base = `http://127.0.0.1:${port}`;
  const skillDir = path.join(__dirname, '..', 'skill');
  const config = {
    llm: { baseUrl: base + '/v1', model: 'qwen-plus', apiKey: 'k', temperature: 0.3 },
    search: { provider: 'bocha', apiKey: 'k', endpoint: base + '/search' },
    maxToolCalls: 30,
  };

  const sp = systemPrompt(skillDir, 30);
  assert(sp.includes('AI 工具选型顾问') && !sp.startsWith('---'), 'Skill 应作为系统提示词载入');

  const events = [];
  const answer = await runTurn({ config, skillDir, history: [], userText: '文字转小红书视频', onEvent: e => events.push(e) });
  assert(answer.includes('## 工具对比'));
  const ends = events.filter(e => e.type === 'tool_end');
  assert.strictEqual(ends.length, 4);
  assert(ends.find(e => e.id === 'c3').ok && ends.find(e => e.id === 'c3').summary === 'Example');
  assert(!ends.find(e => e.id === 'c4').ok, '404 页面应标记失败');
  assert.strictEqual(log.find(x => x.search).search.query, 'site:coze.cn 文字转视频 智能体');
  const firstReq = log.find(x => x.messages);
  assert.strictEqual(firstReq.messages[0].role, 'system');
  assert(firstReq.tools.length >= 2);

  // 追问：只带历史报告，不再调用工具
  const follow = await runTurn({ config, skillDir, history: [{ role: 'user', content: '文字转小红书视频' }, { role: 'assistant', content: answer }], userText: '只看免费的' });
  assert(follow.includes('只看免费的'));

  // 工具预算用完时强制出报告
  log.length = 0;
  const capped = await runTurn({ config: { ...config, maxToolCalls: 2 }, skillDir, history: [], userText: 'x' });
  assert.strictEqual(capped, '好');
  assert(!log.at(-1).tools && log.at(-1).messages.at(-1).content.includes('工具调用次数已用完'));

  // 缺 Key 报错
  await assert.rejects(runTurn({ config: { ...config, llm: { ...config.llm, apiKey: '' } }, skillDir, history: [], userText: 'x' }), /API Key/);

  // 导出
  const x = await toXlsx(answer, '文字转小红书视频');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(x);
  const ws = wb.getWorksheet('工具对比');
  assert.strictEqual(ws.getRow(1).getCell(1).value, '工具/智能体');
  assert.strictEqual(ws.rowCount, 3);
  assert(ws.getRow(2).getCell(1).value.hyperlink.endsWith('/page'));
  const d = await toDocx(answer, '文字转小红书视频');
  assert(d.length > 5000 && d.subarray(0, 2).toString() === 'PK');

  server.close();
  console.log('全部通过');
})().catch(e => { console.error(e); process.exit(1); });
