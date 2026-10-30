// 暴露给模型的工具：web_search、fetch_page、read_reference。
const fs = require('fs');
const path = require('path');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0 Safari/537.36';
const PAGE_CHARS = 6000;

function toolSchemas(referenceNames) {
  const schemas = [
    {
      type: 'function',
      function: {
        name: 'web_search',
        description: '联网搜索（国内搜索接口）。返回标题、链接、摘要。用 site 参数限定站点，例如 coze.cn、ai-bot.cn。',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: '检索词，不要包含 site: 前缀' },
            site: { type: 'string', description: '可选，限定站点域名，如 coze.cn' },
            count: { type: 'integer', description: '返回条数，默认 8，最多 10' },
          },
          required: ['query'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'fetch_page',
        description: '打开网页并抽取正文（官网、定价页、API 文档），用于核实是否免费、能否接入、是否国内可用。超时 10 秒。',
        parameters: {
          type: 'object',
          properties: { url: { type: 'string', description: '完整的 http(s) 链接' } },
          required: ['url'],
        },
      },
    },
  ];
  if (referenceNames.length) {
    schemas.push({
      type: 'function',
      function: {
        name: 'read_reference',
        description: '读取 Skill 附带的参考文件（测试案例、判定规则等）。',
        parameters: {
          type: 'object',
          properties: { name: { type: 'string', enum: referenceNames } },
          required: ['name'],
        },
      },
    });
  }
  return schemas;
}

function listReferences(skillDir) {
  const out = [];
  for (const sub of ['references', 'examples']) {
    const dir = path.join(skillDir, sub);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) if (f.endsWith('.md')) out.push(`${sub}/${f}`);
  }
  return out;
}

async function webSearch({ query, site, count }, { search, fetchImpl }) {
  if (!search.apiKey) throw new Error('未配置搜索 API Key，请在设置里填写');
  const q = site ? `site:${site.replace(/^https?:\/\//, '').replace(/\/.*$/, '')} ${query}` : query;
  const n = Math.min(Math.max(parseInt(count, 10) || 8, 1), 10);
  let results;
  if (search.provider === 'zhipu') {
    const res = await postJson(fetchImpl, search.endpoint || 'https://open.bigmodel.cn/api/paas/v4/web_search', search.apiKey,
      { search_query: q, search_engine: 'search_std', count: n });
    results = (res.search_result || []).map(r => ({ title: r.title, url: r.link, snippet: r.content, site: r.media, date: r.publish_date }));
  } else {
    const res = await postJson(fetchImpl, search.endpoint || 'https://api.bochaai.com/v1/web-search', search.apiKey,
      { query: q, summary: true, count: n, freshness: 'noLimit' });
    const items = res?.data?.webPages?.value || [];
    results = items.map(r => ({ title: r.name, url: r.url, snippet: r.summary || r.snippet, site: r.siteName, date: r.datePublished || r.dateLastCrawled }));
  }
  results = results.slice(0, n).map(r => ({ ...r, snippet: clip(r.snippet || '', 300) }));
  return { query: q, count: results.length, results };
}

async function postJson(fetchImpl, url, key, body) {
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`搜索接口返回 ${res.status}：${clip(text, 200)}`);
  return JSON.parse(text);
}

async function fetchPage({ url }, { fetchImpl }) {
  if (!/^https?:\/\//i.test(url || '')) throw new Error('链接必须以 http:// 或 https:// 开头');
  const res = await fetchImpl(url, {
    headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,*/*;q=0.8', 'Accept-Language': 'zh-CN,zh;q=0.9' },
    redirect: 'follow',
    signal: AbortSignal.timeout(10000),
  });
  const type = res.headers.get('content-type') || '';
  if (!res.ok) return { url, finalUrl: res.url, status: res.status, error: `页面返回 ${res.status}` };
  if (!/html|text|json|xml/i.test(type)) return { url, finalUrl: res.url, status: res.status, error: `不是网页（${type}）` };
  const buf = Buffer.from(await res.arrayBuffer());
  const html = decode(buf, type);
  const { title, description, text } = extractText(html);
  return {
    url, finalUrl: res.url, status: res.status, title, description,
    text: clip(text, PAGE_CHARS),
    note: text.length < 200 ? '正文很少，可能是前端渲染页面，可改用搜索摘要核实' : undefined,
  };
}

function decode(buf, contentType) {
  let charset = (contentType.match(/charset=([\w-]+)/i) || [])[1];
  if (!charset) {
    const head = buf.subarray(0, 2048).toString('latin1');
    charset = (head.match(/<meta[^>]+charset=["']?([\w-]+)/i) || [])[1];
  }
  try { return new TextDecoder(charset || 'utf-8').decode(buf); } catch { return new TextDecoder('utf-8').decode(buf); }
}

function extractText(html) {
  const title = clean((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '');
  const description = clean((html.match(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)/i) || [])[1] || '');
  const body = html
    .replace(/<(script|style|noscript|svg|iframe|template)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article|br)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  const text = clean(body).replace(/\n\s*\n+/g, '\n');
  return { title, description, text };
}

function clean(s) {
  return s
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/[ \t\r\f\v]+/g, ' ').replace(/ *\n */g, '\n').trim();
}

function clip(s, n) { return s.length > n ? s.slice(0, n) + '…' : s; }

function readReference({ name }, { skillDir }) {
  const refs = listReferences(skillDir);
  if (!refs.includes(name)) throw new Error(`没有这个参考文件，可选：${refs.join('、')}`);
  return { name, content: fs.readFileSync(path.join(skillDir, name), 'utf8') };
}

const IMPL = { web_search: webSearch, fetch_page: fetchPage, read_reference: readReference };

module.exports = { toolSchemas, listReferences, IMPL, extractText };
