/**
 * 验证保活面板+保活进程是否正常运行
 */
import { readFileSync, appendFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXT_DIR = join('E:\\API获取工具\\ZO注册', 'ext-crack');
const LOG_DIR = join(__dirname, 'logs', 'verify_panel');
const ACCOUNTS_FILE = join(__dirname, 'keepalive', 'accounts.json');
if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));
const now = () => new Date().toISOString();
const log = msg => { const m = `[${now()}] ${msg}`; console.log(m); appendFileSync(join(LOG_DIR, 'log.txt'), m + '\n'); };

const accounts = JSON.parse(readFileSync(ACCOUNTS_FILE, 'utf-8'));
const acc = accounts[0];

async function main() {
  const { chromium } = await import('playwright');
  const context = await chromium.launchPersistentContext(
    join(homedir(), 'AppData', 'Local', 'zo-verify'),
    { headless: false, executablePath: 'C:\\Users\\XZXyuan\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe', args: [`--disable-extensions-except=${EXT_DIR}`, `--load-extension=${EXT_DIR}`, '--disable-blink-features=AutomationControlled', '--window-size=1440,900'] }
  );
  const page = context.pages()[0] || await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('DOM.enable');

  // 直接打开ZO子域名
  log(`打开: https://builderpcux.zo.computer`);
  try { await page.goto('https://builderpcux.zo.computer', { waitUntil: 'domcontentloaded', timeout: 30000 }); } catch(e) {}
  await sleep(10000);

  const url = page.url();
  log(`当前URL: ${url}`);

  // 如果需要登录
  if (url.includes('signup') || url.includes('www.zo.computer')) {
    log('需要登录...');
    await page.evaluate(e => {
      const inp = document.querySelector('input[type=email]') || document.querySelector('input');
      if (inp) {
        const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        s.call(inp, e);
        inp.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }, acc.email).catch(() => {});
    await sleep(500);
    await page.evaluate(() => {
      for (const btn of document.querySelectorAll('button')) {
        if (/continue/i.test(btn.textContent || '')) { btn.click(); return; }
      }
    }).catch(() => {});
    await sleep(5000);
    log('等待magic link(60s)...');
    await sleep(60000);
  }

  // 检查是否到了ZO桌面
  const currentUrl = page.url();
  log(`当前URL: ${currentUrl}`);

  if (currentUrl.includes('builderpcux.zo.computer') && !currentUrl.includes('signup')) {
    log('✅ 已登录ZO桌面');

    // 开终端验证
    await page.keyboard.press('Control+Backquote');
    await sleep(8000);

    // 聚焦终端
    await page.evaluate(() => {
      const ta = document.querySelector('.xterm-helper-textarea') || document.querySelector('textarea[aria-label]');
      if (ta) { ta.focus(); ta.click(); return; }
      for (const t of document.querySelectorAll('textarea')) { if (t.offsetParent) { t.focus(); t.click(); return; } }
    }).catch(() => {});
    await sleep(2000);

    // 发命令到终端
    async function term(cmd, desc, waitMs = 15000) {
      log(`[${desc}]`);
      await page.evaluate(c => navigator.clipboard.writeText(c), cmd).catch(() => {});
      await sleep(300);
      await page.keyboard.press('Control+v');
      await sleep(500);
      await page.keyboard.press('Enter');
      log(`  发送: ${cmd.substring(0, 60)}...`);
      await sleep(waitMs);
    }

    // 验证保活
    await term('ps aux | grep -v grep | grep keepalive && echo "KEEPALIVE_RUNNING" || echo "KEEPALIVE_NOT_RUNNING"', '检查保活进程');
    await term('curl -s localhost:3000/api/state 2>/dev/null | head -20 || echo "PANEL_FAIL"', '检查面板API');
    await term('cat /tmp/keepalive.log 2>/dev/null | tail -5 || echo "NO_LOG"', '检查保活日志');
    await term('curl -s -o /dev/null -w "%{http_code}" localhost/keepalive/ 2>/dev/null || echo "NGINX_FAIL"', '检查nginx路径');
    await term('sudo netstat -tlnp | grep -E ":3000|:80" | head -10', '端口检查');

    log('\n===== 验证结果 =====');
    log('面板地址: https://builderpcux.zo.computer/keepalive/');
    log('面板API:  https://builderpcux.zo.computer/keepalive/api/state');

  } else {
    log('❌ 未能登录ZO桌面');
  }

  log('\n保持120s后关闭...');
  await sleep(120000);
  await context.close();
  log('完成');
}

main().catch(e => { log(`错误: ${e.message}`); console.error(e); process.exit(1); });
