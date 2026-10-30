// 端到端：启动 Electron，用模拟接口跑一次调研并截图。运行：xvfb-run node test/e2e.js <输出目录>
const { _electron: electron } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { start } = require('./mock-server');

(async () => {
  const out = process.argv[2] || path.join(__dirname, 'shots');
  fs.mkdirSync(out, { recursive: true });
  const { server, port } = await start();
  const base = `http://127.0.0.1:${port}`;
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'scout-'));
  fs.writeFileSync(path.join(userData, 'config.json'), JSON.stringify({
    llm: { provider: 'qwen', baseUrl: base + '/v1', model: 'qwen-plus', apiKey: 'k', temperature: 0.3 },
    search: { provider: 'bocha', apiKey: 'k', endpoint: base + '/search' },
    theme: process.env.THEME || 'light',
  }));

  const app = await electron.launch({
    executablePath: require('electron'),
    args: [path.join(__dirname, '..'), `--user-data-dir=${userData}`, '--no-sandbox', '--no-proxy-server'],
  });
  const win = await app.firstWindow();
  await win.setViewportSize({ width: 1200, height: 820 });
  await win.waitForSelector('.ex');
  await win.waitForTimeout(500);
  await win.screenshot({ path: path.join(out, '1-home.png') });

  await win.click('.ex');
  await win.waitForSelector('.step');
  await win.waitForTimeout(700);
  await win.screenshot({ path: path.join(out, '2-running.png') });

  await win.waitForSelector('.report table', { timeout: 20000 });
  await win.waitForTimeout(500);
  await win.screenshot({ path: path.join(out, '3-report.png') });
  await win.evaluate(() => { document.getElementById('scroll').scrollTop = 1e6; });
  await win.screenshot({ path: path.join(out, '4-report-bottom.png') });

  await win.click('#btn-collapse');
  await win.click('#btn-settings');
  await win.waitForTimeout(500);
  await win.screenshot({ path: path.join(out, '5-settings.png') });

  const errs = [];
  win.on('pageerror', e => errs.push(e.message));
  await app.close();
  server.close();
  console.log('ok', errs);
})().catch(e => { console.error(e); process.exit(1); });
