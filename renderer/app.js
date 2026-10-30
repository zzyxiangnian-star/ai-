const api = window.scout;
const $ = (id) => document.getElementById(id);

const EXAMPLES = [
  { k: '内容生成', q: '我想要一个能自动把文字转成小红书视频的智能体' },
  { k: '自动化与监控', q: '我想要一个能自动监控表格数据异常并提醒的智能体' },
  { k: '办公协作', q: '开完会自动生成会议纪要，并把待办同步到飞书' },
];
const THEMES = { system: ['跟随系统', 'auto'], light: ['浅色', 'sun'], dark: ['深色', 'moon'] };

const state = {
  config: null,
  presets: null,
  sessions: new Map(), // 已加载的会话
  currentId: null,
  running: new Set(),
};

// ---------- 工具函数 ----------
function el(tag, cls, html) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html != null) n.innerHTML = html;
  return n;
}
function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function hydrateIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach(n => { n.innerHTML = icon(n.dataset.icon); });
}
function animate(btn) {
  const a = btn.dataset.anim;
  if (!a) return;
  btn.classList.remove('anim-' + a);
  void btn.offsetWidth;
  btn.classList.add('anim-' + a);
}
let toastTimer;
function toast(text) {
  const t = $('toast');
  t.textContent = text;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 2600);
}
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

// ---------- 主题与侧栏 ----------
function applyTheme() {
  const t = state.config.theme || 'system';
  document.documentElement.dataset.theme = t;
  const [label, ic] = THEMES[t];
  $('theme-label').textContent = label;
  $('btn-theme').querySelector('.ico').innerHTML = icon(ic);
}
function applySidebar() { $('app').classList.toggle('collapsed', !!state.config.sidebarCollapsed); }
async function patchConfig(patch) {
  state.config = await api.setConfig({ ...state.config, ...patch });
}

// ---------- 状态行 ----------
function renderStatus() {
  const c = state.config;
  const llm = state.presets.llm[c.llm.provider]?.label || '自定义';
  const search = state.presets.search[c.search.provider]?.label || '';
  $('model-hint').textContent = `${llm} · ${c.llm.model || '未填模型'} · ${search}`;
  const s = $('status');
  const missing = [!c.llm.apiKey && '大模型 API Key', !c.search.apiKey && '搜索 API Key'].filter(Boolean);
  s.innerHTML = missing.length
    ? `<span class="warn">还没有配置${missing.join('和')}。</span><button id="go-settings">去设置</button>`
    : `<span>当前使用 ${esc(llm)}（${esc(c.llm.model)}），搜索走 ${esc(search)}。</span>`;
  $('go-settings')?.addEventListener('click', openSettings);
}

// ---------- 历史记录 ----------
async function renderHistory() {
  const list = await api.listHistory();
  const box = $('history');
  box.innerHTML = '';
  if (!list.length) { box.append(el('div', 'h-empty label', '还没有调研记录')); return; }
  for (const h of list) {
    const item = el('div', 'h-item' + (h.id === state.currentId ? ' active' : ''));
    item.innerHTML = `<span class="t">${esc(h.title)}</span>${state.running.has(h.id) ? '<span class="dot" title="调研中"></span>' : ''}<button class="del" title="删除">${icon('trash')}</button>`;
    item.addEventListener('click', () => openSession(h.id));
    item.querySelector('.del').addEventListener('click', async (e) => {
      e.stopPropagation();
      if (state.running.has(h.id)) { toast('这条调研还在进行，先停止再删除'); return; }
      await api.deleteSession(h.id);
      state.sessions.delete(h.id);
      if (state.currentId === h.id) newSession();
      renderHistory();
    });
    box.append(item);
  }
}

async function openSession(id) {
  if (!state.sessions.has(id)) state.sessions.set(id, await api.getSession(id));
  state.currentId = id;
  showChat();
  renderTurns();
  renderHistory();
}

function newSession() {
  state.currentId = null;
  $('view-chat').classList.add('hidden');
  $('view-home').classList.remove('hidden');
  $('home-slot').append($('composer'));
  $('input').value = '';
  autoGrow();
  syncButtons();
  renderHistory();
  $('input').focus();
}

function showChat() {
  $('view-home').classList.add('hidden');
  $('view-chat').classList.remove('hidden');
  $('chat-slot').append($('composer'));
  syncButtons();
}

const current = () => state.sessions.get(state.currentId);
const persist = (s) => api.saveSession(s);

// ---------- 对话渲染 ----------
function renderTurns() {
  const s = current();
  const box = $('turns');
  box.innerHTML = '';
  if (!s) return;
  s.turns.forEach((t, i) => box.append(renderTurn(s, t, i)));
  scrollBottom();
}

function renderTurn(s, t, i) {
  const wrap = el('div', 'turn');
  wrap.dataset.idx = i;
  wrap.append(el('div', 'u-msg', esc(t.user)));

  const toolSteps = t.steps.filter(x => x.name);
  if (t.steps.length) {
    const box = el('div', 'steps' + (t.pending ? ' open' : ''));
    const head = el('button', 'steps-head');
    const doneCount = toolSteps.filter(x => x.state !== 'run').length;
    head.innerHTML = `${icon('chevron', 'chev')}<span class="title">${t.pending ? '正在调研' : '调研过程'}</span><span class="count">搜索 ${toolSteps.filter(x => x.name === 'web_search').length} 次 · 打开网页 ${toolSteps.filter(x => x.name === 'fetch_page').length} 个${t.pending ? ` · 已完成 ${doneCount}/${toolSteps.length}` : ''}</span>`;
    head.addEventListener('click', () => box.classList.toggle('open'));
    const list = el('div', 'steps-list');
    for (const st of t.steps) list.append(renderStep(st));
    box.append(head, list);
    wrap.append(box);
  }

  if (t.pending) {
    wrap.append(el('div', 'live', `<span class="spinner"></span><span>${t.steps.length ? '正在检索和核实，结果出来后会生成对比表' : '正在拆解需求'}</span>`));
  } else if (t.error) {
    const err = el('div', 'err', `${icon('alert')}<span class="msg">${esc(t.error)}</span>`);
    const retry = el('button', 'chip', `${icon('retry')}重试`);
    retry.addEventListener('click', () => { s.turns.splice(i, 1); send(t.user); });
    err.append(retry);
    wrap.append(err);
  } else if (t.answer) {
    const rep = el('div', 'report');
    rep.innerHTML = renderMarkdown(t.answer);
    wrap.append(rep);
    const acts = el('div', 'actions');
    const mk = (ic, label, fn) => { const b = el('button', 'chip', `${icon(ic)}${label}`); b.addEventListener('click', fn); acts.append(b); };
    const title = s.title;
    mk('copy', '复制', async () => { await navigator.clipboard.writeText(t.answer); toast('已复制报告'); });
    if (/\|\s*-{3,}/.test(t.answer)) mk('sheet', '导出 Excel', () => doExport('xlsx', t.answer, title));
    mk('doc', '导出 Word', () => doExport('docx', t.answer, title));
    mk('md', '导出 Markdown', () => doExport('md', t.answer, title));
    wrap.append(acts);
  }
  return wrap;
}

function renderStep(st) {
  if (st.type === 'note') {
    const n = el('div', 'step note');
    n.innerHTML = `${icon('spark')}<div class="body"><div class="what">${esc(st.text)}</div></div>`;
    return n;
  }
  const n = el('div', 'step ' + st.state);
  const a = st.args || {};
  let ic = 'file', what = esc(a.name || '');
  if (st.name === 'web_search') { ic = 'search'; what = `${esc(a.query || '')}${a.site ? ` <span class="site">· ${esc(a.site)}</span>` : ''}`; }
  if (st.name === 'fetch_page') { ic = 'globe'; what = esc(a.url || ''); }
  const stateIco = st.state === 'run' ? '<span class="spinner"></span>' : icon(st.state === 'ok' ? 'check' : 'alert');
  n.innerHTML = `${icon(ic)}<div class="body"><div class="what">${what}</div>${st.summary ? `<div class="res">${esc(st.summary)}</div>` : ''}</div><span class="state">${stateIco}</span>`;
  return n;
}

function renderMarkdown(md) {
  const html = DOMPurify.sanitize(marked.parse(md, { gfm: true, breaks: false }));
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  tpl.content.querySelectorAll('table').forEach(tb => {
    const w = document.createElement('div');
    w.className = 'table-wrap';
    tb.replaceWith(w);
    w.append(tb);
  });
  tpl.content.querySelectorAll('a').forEach(a => { a.target = '_blank'; a.rel = 'noreferrer'; });
  tpl.content.querySelectorAll('td').forEach(td => {
    if (/^完全满足/.test(td.textContent.trim())) td.classList.add('tag-full');
    else if (/^部分满足/.test(td.textContent.trim())) td.classList.add('tag-part');
  });
  const d = document.createElement('div');
  d.append(tpl.content);
  return d.innerHTML;
}

function rerenderTurn(s, i) {
  if (state.currentId !== s.id) return;
  const old = $('turns').querySelector(`.turn[data-idx="${i}"]`);
  const keepOpen = old?.querySelector('.steps')?.classList.contains('open');
  const fresh = renderTurn(s, s.turns[i], i);
  fresh.style.animation = 'none';
  if (keepOpen !== undefined) fresh.querySelector('.steps')?.classList.toggle('open', keepOpen);
  const nearBottom = isNearBottom();
  if (old) old.replaceWith(fresh); else $('turns').append(fresh);
  if (nearBottom) scrollBottom();
}

function isNearBottom() { const sc = $('scroll'); return sc.scrollHeight - sc.scrollTop - sc.clientHeight < 120; }
function scrollBottom() { const sc = $('scroll'); sc.scrollTop = sc.scrollHeight; }

async function doExport(format, markdown, title) {
  try {
    const r = await api.exportReport({ format, markdown, title });
    if (r.ok) toast('已导出：' + r.filePath);
  } catch (e) { toast('导出失败：' + e.message.replace(/^Error invoking remote method '[^']+': /, '')); }
}

// ---------- 发送 ----------
async function send(text) {
  text = text.trim();
  if (!text) return;
  let s = current();
  if (!s) {
    s = { id: newId(), title: text.slice(0, 40), createdAt: Date.now(), updatedAt: Date.now(), turns: [] };
    state.sessions.set(s.id, s);
    state.currentId = s.id;
    showChat();
  }
  if (state.running.has(s.id)) return;

  const history = s.turns.filter(t => t.answer).flatMap(t => [{ role: 'user', content: t.user }, { role: 'assistant', content: t.answer }]);
  const turn = { user: text, steps: [], pending: true, at: Date.now() };
  s.turns.push(turn);
  const idx = s.turns.length - 1;
  state.running.add(s.id);
  $('input').value = '';
  autoGrow();
  syncButtons();
  renderTurns();
  await persist(s);
  renderHistory();

  const r = await api.run({ sessionId: s.id, history, text });
  turn.pending = false;
  for (const st of turn.steps) if (st.state === 'run') st.state = 'fail';
  if (r.ok) turn.answer = r.answer; else turn.error = r.error;
  s.updatedAt = Date.now();
  state.running.delete(s.id);
  await persist(s);
  rerenderTurn(s, idx);
  syncButtons();
  renderHistory();
}

api.onEvent((ev) => {
  const s = state.sessions.get(ev.sessionId);
  if (!s) return;
  const i = s.turns.length - 1;
  const t = s.turns[i];
  if (!t?.pending) return;
  if (ev.type === 'tool_start') t.steps.push({ id: ev.id, name: ev.name, args: ev.args, state: 'run' });
  else if (ev.type === 'tool_end') {
    const st = t.steps.find(x => x.id === ev.id && x.state === 'run');
    if (st) { st.state = ev.ok ? 'ok' : 'fail'; st.summary = ev.summary; }
  } else if (ev.type === 'note') t.steps.push({ type: 'note', text: ev.text });
  else return;
  rerenderTurn(s, i);
});

function syncButtons() {
  const busy = state.currentId && state.running.has(state.currentId);
  $('btn-stop').classList.toggle('hidden', !busy);
  $('btn-send').classList.toggle('hidden', !!busy);
  $('btn-send').disabled = !$('input').value.trim();
  $('input').placeholder = state.currentId ? '继续追问，例如：只看免费的 / 展开第 2 个工具' : '例如：我想要一个能自动把文字转成小红书视频的智能体';
}

function autoGrow() {
  const t = $('input');
  t.style.height = 'auto';
  t.style.height = Math.min(t.scrollHeight, 200) + 'px';
}

// ---------- 设置 ----------
function openSettings() {
  const c = state.config;
  const p = state.presets;
  $('f-provider').innerHTML = Object.entries(p.llm).map(([k, v]) => `<option value="${k}">${esc(v.label)}</option>`).join('');
  $('f-search').innerHTML = Object.entries(p.search).map(([k, v]) => `<option value="${k}">${esc(v.label)}</option>`).join('');
  $('f-provider').value = c.llm.provider;
  $('f-baseurl').value = c.llm.baseUrl;
  $('f-model').value = c.llm.model;
  $('f-temp').value = c.llm.temperature;
  $('f-llmkey').value = c.llm.apiKey;
  $('f-search').value = c.search.provider;
  $('f-searchkey').value = c.search.apiKey;
  $('f-max').value = c.maxToolCalls;
  $('test-result').innerHTML = '';
  syncKeyLinks();
  $('settings').classList.remove('hidden');
}
function closeSettings() { $('settings').classList.add('hidden'); }
function syncKeyLinks() {
  const l = state.presets.llm[$('f-provider').value];
  const s = state.presets.search[$('f-search').value];
  $('llm-key-link').href = l?.keyUrl || '#';
  $('llm-key-link').classList.toggle('hidden', !l?.keyUrl);
  $('search-key-link').href = s?.keyUrl || '#';
  $('llm-key-link').target = $('search-key-link').target = '_blank';
}
function readForm() {
  return {
    ...state.config,
    llm: {
      provider: $('f-provider').value,
      baseUrl: $('f-baseurl').value.trim(),
      model: $('f-model').value.trim(),
      temperature: Number($('f-temp').value) || 0.3,
      apiKey: $('f-llmkey').value.trim(),
    },
    search: { ...state.config.search, provider: $('f-search').value, apiKey: $('f-searchkey').value.trim() },
    maxToolCalls: Math.min(Math.max(parseInt($('f-max').value, 10) || 30, 5), 80),
  };
}

$('f-provider').addEventListener('change', () => {
  const p = state.presets.llm[$('f-provider').value];
  if (p.baseUrl) $('f-baseurl').value = p.baseUrl;
  if (p.model) $('f-model').value = p.model;
  syncKeyLinks();
});
$('f-search').addEventListener('change', syncKeyLinks);
$('btn-close-settings').addEventListener('click', closeSettings);
$('settings').addEventListener('click', (e) => { if (e.target === $('settings')) closeSettings(); });
$('btn-save').addEventListener('click', async () => {
  state.config = await api.setConfig(readForm());
  renderStatus();
  closeSettings();
  toast('设置已保存');
});
$('btn-test').addEventListener('click', async () => {
  const b = $('btn-test');
  b.disabled = true;
  $('test-result').innerHTML = '<div class="live"><span class="spinner"></span>正在测试模型和搜索接口</div>';
  const r = await api.testConfig(readForm());
  const line = (name, x) => `<div class="${x.ok ? 'ok' : 'no'}">${name}：${esc(x.text)}</div>`;
  $('test-result').innerHTML = line('大模型', r.llm) + line('搜索', r.search);
  b.disabled = false;
});

// ---------- 事件绑定 ----------
document.querySelectorAll('[data-anim]').forEach(b => b.addEventListener('click', () => animate(b)));
$('btn-new').addEventListener('click', newSession);
$('btn-settings').addEventListener('click', openSettings);
$('btn-collapse').addEventListener('click', () => { patchConfig({ sidebarCollapsed: !state.config.sidebarCollapsed }).then(applySidebar); });
$('btn-theme').addEventListener('click', async () => {
  const order = ['system', 'light', 'dark'];
  await patchConfig({ theme: order[(order.indexOf(state.config.theme) + 1) % 3] });
  applyTheme();
});
$('btn-stop').addEventListener('click', () => api.stop(state.currentId));
$('composer').addEventListener('submit', (e) => { e.preventDefault(); send($('input').value); });
$('input').addEventListener('input', () => { autoGrow(); syncButtons(); });
$('input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send($('input').value); }
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSettings(); });

// ---------- 启动 ----------
(async function init() {
  hydrateIcons();
  const { config, presets } = await api.getConfig();
  state.config = config;
  state.presets = presets;
  applyTheme();
  applySidebar();
  const ex = $('examples');
  for (const e of EXAMPLES) {
    const b = el('button', 'ex', `<span class="k">${esc(e.k)}</span><span class="q">${esc(e.q)}</span>`);
    b.addEventListener('click', () => send(e.q));
    ex.append(b);
  }
  renderStatus();
  newSession();
})();
