// Agent 主循环：专家 Skill 作系统提示词，模型通过函数调用自主检索与核实，最后输出报告。
const fs = require('fs');
const path = require('path');
const { toolSchemas, listReferences, IMPL } = require('./tools');

function loadSkill(skillDir) {
  const raw = fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8');
  return raw.replace(/^---[\s\S]*?\n---\s*\n/, ''); // 去掉 frontmatter
}

function systemPrompt(skillDir, maxToolCalls) {
  const today = new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });
  return `${loadSkill(skillDir)}

# 运行环境（桌面应用）

- 今天是 ${today}。
- 你只能通过工具获取外部信息：web_search（联网搜索，用 site 参数限定站点）、fetch_page（打开网页读取正文）${listReferences(skillDir).length ? '、read_reference（读取 Skill 附带的参考文件）' : ''}。
- 第 2 步检索和第 3 步核实必须实际调用工具完成。报告里的每个链接都必须来自工具返回的结果。
- 本轮最多 ${maxToolCalls} 次工具调用。先按子功能和渠道搜索，再挑最有希望的候选打开官网核实。可以在一次回复里同时发起多个工具调用。
- 页面打不开时不要反复重试同一链接，改用搜索摘要，并在报告中注明“官网未能打开核实”。
- 需求含糊需要追问时，直接用一段简短的话提问并给出 2 到 3 个选项，不调用工具。
- 最终回复只输出第 6 步的报告（Markdown），不输出中间过程。`;
}

async function chat(llm, body, fetchImpl, signal) {
  const url = llm.baseUrl.replace(/\/+$/, '') + '/chat/completions';
  for (let attempt = 0; ; attempt++) {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${llm.apiKey}` },
      body: JSON.stringify({ model: llm.model, temperature: llm.temperature, ...body }),
      signal,
    });
    const text = await res.text();
    if (res.ok) {
      const data = JSON.parse(text);
      if (!data.choices?.length) throw new Error('模型返回为空：' + text.slice(0, 200));
      return data;
    }
    if ((res.status === 429 || res.status >= 500) && attempt < 2) {
      await sleep(2000 * (attempt + 1), signal);
      continue;
    }
    throw new Error(`模型接口返回 ${res.status}：${text.slice(0, 300)}`);
  }
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(t); reject(new Error('已停止')); }, { once: true });
  });
}

function summarize(name, result) {
  if (result.error) return result.error;
  if (name === 'web_search') return `${result.count} 条结果`;
  if (name === 'fetch_page') return result.title || result.finalUrl;
  return '已读取';
}

/**
 * 运行一轮对话。
 * history: 之前轮次的 [{role:'user'|'assistant', content}]，只保留需求与最终报告，节省上下文。
 * 返回最终回复文本。
 */
async function runTurn({ config, skillDir, history, userText, fetchImpl = fetch, onEvent = () => {}, signal }) {
  if (!config.llm.apiKey) throw new Error('未配置大模型 API Key，请先打开设置');
  if (!config.llm.baseUrl || !config.llm.model) throw new Error('请在设置里填写模型接口地址和模型名');

  const maxCalls = config.maxToolCalls || 30;
  const tools = toolSchemas(listReferences(skillDir));
  const ctx = { search: config.search, fetchImpl, skillDir };
  const messages = [
    { role: 'system', content: systemPrompt(skillDir, maxCalls) },
    ...history,
    { role: 'user', content: userText },
  ];
  let used = 0;

  for (let round = 0; round < maxCalls + 5; round++) {
    const exhausted = used >= maxCalls;
    if (exhausted) messages.push({ role: 'user', content: '工具调用次数已用完。请基于已获得的信息，直接按模板输出最终报告。' });
    onEvent({ type: 'thinking' });
    const data = await chat(config.llm, exhausted ? { messages } : { messages, tools, tool_choice: 'auto' }, fetchImpl, signal);
    const msg = data.choices[0].message;
    const calls = msg.tool_calls || [];
    if (!calls.length || exhausted) {
      const text = (msg.content || '').trim();
      if (!text) throw new Error('模型没有返回内容');
      return text;
    }

    messages.push({ role: 'assistant', content: msg.content || '', tool_calls: calls });
    if (msg.content?.trim()) onEvent({ type: 'note', text: msg.content.trim() });

    const results = await Promise.all(calls.map(async (call) => {
      const name = call.function?.name;
      let args = {};
      try { args = JSON.parse(call.function?.arguments || '{}'); } catch {}
      const id = call.id;
      used++;
      onEvent({ type: 'tool_start', id, name, args });
      let result;
      try {
        if (!IMPL[name]) throw new Error(`未知工具 ${name}`);
        result = await IMPL[name](args, ctx);
      } catch (e) {
        if (signal?.aborted) throw new Error('已停止');
        result = { error: e.name === 'TimeoutError' ? '请求超时' : e.message };
      }
      onEvent({ type: 'tool_end', id, name, ok: !result.error, summary: summarize(name, result) });
      return { role: 'tool', tool_call_id: id, content: JSON.stringify(result) };
    }));
    messages.push(...results);
  }
  throw new Error('对话轮数超出上限');
}

module.exports = { runTurn, systemPrompt, chat };
