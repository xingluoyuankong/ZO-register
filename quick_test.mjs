/**
 * 快速测试面板（复用已有session）
 */
import { appendFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXT_DIR = join(__dirname, 'ext-crack');
const LOG_DIR = join(__dirname, 'logs', 'quick');
if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));
const now = () => new Date().toISOString();
const log = msg => { const m = `[${now()}] ${msg}`; console.log(m); appendFileSync(join(LOG_DIR, 'log.txt'), m + '\n'); };

async function main() {
  const { chromium } = await import('playwright');
  const context = await chromium.launchPersistentContext(
    join(homedir(), 'AppData', 'Local', 'zo-panel-path'),
    { headless: false, executablePath: 'C:\\Users\\XZXyuan\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe', args: [`--disable-extensions-except=${EXT_DIR}`, `--load-extension=${EXT_DIR}`, '--disable-blink-features=AutomationControlled', '--window-size=1440,900'] }
  );
  const page = context.pages()[0] || await context.newPage();

  log('打开ZO...');
  try { await page.goto('https://builderpcux.zo.computer', { waitUntil: 'domcontentloaded', timeout: 30000 }); } catch(e) {}
  await sleep(10000);

  const url = page.url();
  if (url.includes('signup')) { log('需登录'); await context.close(); return; }
  log(`已登录`);

  // 测试面板
  const r = await page.evaluate(async () => {
    const results = {};
    try { const res = await fetch('/keepalive/'); results.panel = { status: res.status, ok: res.ok, text: (await res.text()).substring(0, 500) }; } catch(e) { results.panel = { error: e.message }; }
    try { const res = await fetch('/keepalive/api/state'); results.api = { status: res.status, ok: res.ok, json: await res.json() }; } catch(e) { results.api = { error: e.message }; }
    try { const res = await fetch('/'); results.home = { status: res.status, ok: res.ok }; } catch(e) { results.home = { error: e.message }; }
    return results;
  });

  log(`ZO首页: ${JSON.stringify(r.home)}`);
  log(`面板: ${JSON.stringify(r.panel)}`);
  log(`API: ${JSON.stringify(r.api)}`);

  if (r.api?.json) {
    log(`\n🎉 面板工作！`);
    log(JSON.stringify(r.api.json, null, 2));
  } else if (r.panel?.status === 200) {
    log(`\n✅ 面板200 OK`);
  } else {
    log(`\n❌ 面板不可访问 (status: ${r.panel?.status || 'N/A'})`);
  }

  await sleep(30000);
  await context.close();
}

main().catch(e => { log(`错误: ${e.message}`); process.exit(1); });
