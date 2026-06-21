/**
 * 在已登录的ZO桌面中，通过fetch测试/keepalive面板是否可访问
 */
import { appendFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXT_DIR = join('E:\\API获取工具\\ZO注册', 'ext-crack');
const LOG_DIR = join(__dirname, 'logs', 'panel_test');
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

  // 直接用持久化session打开ZO桌面
  log('打开ZO桌面...');
  try { await page.goto('https://builderpcux.zo.computer', { waitUntil: 'domcontentloaded', timeout: 30000 }); } catch(e) {}
  await sleep(10000);

  const url = page.url();
  log(`URL: ${url}`);
  
  if (url.includes('signup') || url.includes('www.zo.computer')) {
    log('Session过期，需要重新登录。跳过。');
    await context.close();
    return;
  }

  // 在ZO页面内通过fetch测试keepalive面板
  log('\n===== 测试面板可访问性 =====');
  
  const results = await page.evaluate(async () => {
    const results = {};
    
    // 测试1: 直接fetch /keepalive/ (走nginx反向代理)
    try {
      const r = await fetch('/keepalive/');
      results.panelHTML = { status: r.status, ok: r.ok, text: (await r.text()).substring(0, 300) };
    } catch(e) {
      results.panelHTML = { error: e.message };
    }

    // 测试2: fetch /keepalive/api/state
    try {
      const r = await fetch('/keepalive/api/state');
      results.panelAPI = { status: r.status, ok: r.ok, json: await r.json() };
    } catch(e) {
      results.panelAPI = { error: e.message };
    }

    // 测试3: fetch ZO桌面本身
    try {
      const r = await fetch('/');
      results.zoDesktop = { status: r.status, ok: r.ok, text: (await r.text()).substring(0, 200) };
    } catch(e) {
      results.zoDesktop = { error: e.message };
    }

    return results;
  });

  log('面板HTML: ' + JSON.stringify(results.panelHTML, null, 2));
  log('面板API:  ' + JSON.stringify(results.panelAPI, null, 2));
  log('ZO桌面:   ' + JSON.stringify(results.zoDesktop, null, 2));

  if (results.panelAPI?.json) {
    const s = results.panelAPI.json;
    log(`\n🎉 保活面板工作正常！`);
    log(`最后活跃: ${s.lastAlive}`);
    log(`运行时长: 周期${s.cycleCount}次`);
    log(`AI消息: ${s.aiMessages}条, 鼠标: ${s.mouseMoves}次`);
  } else {
    log('\n❌ 面板不可访问');
  }

  log('\n保持60s...');
  await sleep(60000);
  await context.close();
}

main().catch(e => { log(`错误: ${e.message}`); process.exit(1); });
