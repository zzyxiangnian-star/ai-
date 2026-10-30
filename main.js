const { app, BrowserWindow, ipcMain, dialog, shell, net, safeStorage, nativeTheme } = require('electron');
const fs = require('fs');
const path = require('path');
const { createStore, LLM_PRESETS, SEARCH_PRESETS } = require('./src/config');
const { runTurn, chat } = require('./src/agent');
const { IMPL } = require('./src/tools');
const { toDocx, toXlsx } = require('./src/export');

const BUNDLED_SKILL = path.join(__dirname, 'skill');
let store, historyDir, win, SKILL_DIR;
const running = new Map(); // sessionId -> AbortController

// 用 Chromium 网络栈发请求，自动沿用系统代理设置
const fetchImpl = (url, opts) => net.fetch(url, opts);

function createWindow() {
  const cfg = store.load();
  nativeTheme.themeSource = cfg.theme;
  win = new BrowserWindow({
    width: 1200, height: 820, minWidth: 860, minHeight: 600,
    title: 'AI 工具推荐助手',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1F1E1C' : '#F6F4EF',
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  // 报告里的链接一律用系统浏览器打开
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file:')) { e.preventDefault(); if (/^https?:/.test(url)) shell.openExternal(url); } });
}

app.whenReady().then(() => {
  store = createStore(app.getPath('userData'), safeStorage);
  historyDir = path.join(app.getPath('userData'), 'history');
  // 用户目录下放了 skill/SKILL.md 时优先用它，方便不重新打包就调整专家提示词
  const custom = path.join(app.getPath('userData'), 'skill');
  SKILL_DIR = fs.existsSync(path.join(custom, 'SKILL.md')) ? custom : BUNDLED_SKILL;
  fs.mkdirSync(historyDir, { recursive: true });
  createWindow();
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

// ---------- 配置 ----------
ipcMain.handle('config:get', () => ({ config: store.load(), presets: { llm: LLM_PRESETS, search: SEARCH_PRESETS } }));
ipcMain.handle('config:set', (_e, cfg) => {
  const saved = store.save(cfg);
  nativeTheme.themeSource = saved.theme;
  return saved;
});

ipcMain.handle('config:test', async (_e, cfg) => {
  const out = { llm: null, search: null };
  try {
    const data = await chat(cfg.llm, { messages: [{ role: 'user', content: '只回复“好”' }], max_tokens: 8 }, fetchImpl, AbortSignal.timeout(20000));
    out.llm = { ok: true, text: `已连通 ${data.model || cfg.llm.model}` };
  } catch (e) { out.llm = { ok: false, text: e.message }; }
  try {
    const r = await IMPL.web_search({ query: 'AI 工具集', count: 1 }, { search: cfg.search, fetchImpl });
    out.search = { ok: true, text: `已连通，返回 ${r.count} 条` };
  } catch (e) { out.search = { ok: false, text: e.message }; }
  return out;
});

// ---------- 对话 ----------
ipcMain.handle('agent:run', async (e, { sessionId, history, text }) => {
  const ac = new AbortController();
  running.set(sessionId, ac);
  const send = (ev) => { if (!e.sender.isDestroyed()) e.sender.send('agent:event', { sessionId, ...ev }); };
  try {
    const answer = await runTurn({ config: store.load(), skillDir: SKILL_DIR, history, userText: text, fetchImpl, onEvent: send, signal: ac.signal });
    return { ok: true, answer };
  } catch (err) {
    return { ok: false, error: ac.signal.aborted ? '已停止' : err.message };
  } finally {
    running.delete(sessionId);
  }
});
ipcMain.handle('agent:stop', (_e, sessionId) => { running.get(sessionId)?.abort(); });

// ---------- 历史记录 ----------
const sessionFile = (id) => path.join(historyDir, `${String(id).replace(/[^\w-]/g, '')}.json`);
ipcMain.handle('history:list', () => fs.readdirSync(historyDir)
  .filter(f => f.endsWith('.json'))
  .map(f => { try { const s = JSON.parse(fs.readFileSync(path.join(historyDir, f), 'utf8')); return { id: s.id, title: s.title, updatedAt: s.updatedAt }; } catch { return null; } })
  .filter(Boolean)
  .sort((a, b) => b.updatedAt - a.updatedAt));
ipcMain.handle('history:get', (_e, id) => JSON.parse(fs.readFileSync(sessionFile(id), 'utf8')));
ipcMain.handle('history:save', (_e, s) => { fs.writeFileSync(sessionFile(s.id), JSON.stringify(s)); });
ipcMain.handle('history:delete', (_e, id) => { fs.rmSync(sessionFile(id), { force: true }); });

// ---------- 导出 ----------
ipcMain.handle('export', async (_e, { format, markdown, title }) => {
  const ext = { xlsx: 'xlsx', docx: 'docx', md: 'md' }[format];
  const safe = (title || '调研报告').replace(/[\\/:*?"<>|\s]+/g, '').slice(0, 30);
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    defaultPath: path.join(app.getPath('documents'), `${safe}.${ext}`),
    filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
  });
  if (canceled || !filePath) return { ok: false };
  const buf = format === 'xlsx' ? await toXlsx(markdown, title)
    : format === 'docx' ? await toDocx(markdown, title)
    : Buffer.from(`# ${title}\n\n${markdown}\n`, 'utf8');
  fs.writeFileSync(filePath, buf);
  shell.showItemInFolder(filePath);
  return { ok: true, filePath };
});
