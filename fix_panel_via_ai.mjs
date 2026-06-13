/**
 * 通过ZO AI聊天执行nginx配置（绕过xterm.js终端输入问题）
 * AI聊天用textarea，比xterm.js终端可靠
 */
import { readFileSync, appendFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXT_DIR = join(__dirname, 'ext-crack');
const LOG_DIR = join(__dirname, 'logs', 'fix_panel');
if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));
const now = () => new Date().toISOString();
const log = msg => { const m = `[${now()}] ${msg}`; console.log(m); appendFileSync(join(LOG_DIR, 'log.txt'), m + '\n'); };
const rand = (a,b) => Math.floor(a+Math.random()*(b-a+1));

async function main() {
  const { chromium } = await import('playwright');
  const context = await chromium.launchPersistentContext(
    join(homedir(), 'AppData', 'Local', 'zo-panel-path'),
    { headless: false, executablePath: 'C:\\Users\\XZXyuan\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe', args: [`--disable-extensions-except=${EXT_DIR}`, `--load-extension=${EXT_DIR}`, '--disable-blink-features=AutomationControlled', '--window-size=1440,900'] }
  );
  const page = context.pages()[0] || await context.newPage();

  // 打开ZO桌面
  log('打开ZO...');
  try { await page.goto('https://builderpcux.zo.computer', { waitUntil: 'domcontentloaded', timeout: 30000 }); } catch(e) {}
  await sleep(10000);

  const url = page.url();
  if (url.includes('signup')) { log('需重新登录'); await context.close(); return; }
  log(`已登录: ${url.substring(0, 80)}`);

  // ★ 通过AI聊天发命令
  // AI输入框是textarea，比xterm终端可靠100倍
  async function aiCmd(cmd, desc, waitMs = 25000) {
    log(`\n[AI] ${desc}`);
    
    // 找AI输入框
    const found = await page.evaluate(() => {
      for (const sel of ['textarea', '[contenteditable="true"]', '[role="textbox"]']) {
        const el = document.querySelector(sel);
        if (el && el.offsetParent) {
          el.focus();
          el.click();
          return sel;
        }
      }
      return null;
    }).catch(() => null);
    
    if (!found) { log('  无输入框'); return; }
    log(`  输入框: ${found}`);
    await sleep(1000);

    // ★ 关键：用剪贴板粘贴（不用type）
    await page.evaluate(c => navigator.clipboard.writeText(c), cmd).catch(() => {});
    await sleep(500);
    await page.keyboard.press('Control+v');
    await sleep(1000);
    await page.keyboard.press('Enter');
    log(`  已发送(${cmd.length}字符)`);
    await sleep(waitMs);
  }

  // ===== 先检查当前状态 =====
  await aiCmd('Run this command and reply with the exact output: ps aux | grep -v grep | grep keepalive || echo "NOT_RUNNING"', '检查保活进程', 15000);
  
  // ===== 步骤1: 启动保活 =====
  await aiCmd('Run this and reply OK if it works: cd /home/user && curl -fsSL -o keepalive.js https://raw.githubusercontent.com/xingluoyuankong/ZO-register/master/keepalive_full_puppet.js && echo "DOWNLOADED"', '下载保活', 15000);
  
  await aiCmd('Run this: pkill -f keepalive.js 2>/dev/null; sleep 1; cd /home/user && nohup xvfb-run -a node keepalive.js > /tmp/keepalive.log 2>&1 & echo "STARTED"', '启动保活', 15000);
  
  await aiCmd('Run: sleep 15 && ps aux | grep -v grep | grep keepalive && echo "RUNNING"', '验证保活', 30000);

  // ===== 步骤2: 配置nginx反向代理 =====
  await aiCmd('Run: which nginx || (sudo apt update -qq && sudo apt install -y nginx) && echo "NGINX_OK"', '安装nginx', 30000);

  const nginxConf = `server {
    listen 80 default_server;
    server_name _;
    location /keepalive/ {
        proxy_pass http://127.0.0.1:3000/;
        proxy_set_header Host \\$host;
    }
    location /keepalive {
        return 301 /keepalive/;
    }
    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host \\$host;
        proxy_set_header X-Real-IP \\$remote_addr;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \\$http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}`;

  // 分两步：先写配置，再reload
  await aiCmd(`Run this exactly and reply with CONFIG_WRITTEN: cat > /tmp/zo_nginx.conf << 'EOF'\n${nginxConf}\nEOF\necho "CONFIG_WRITTEN"`, '写nginx配置', 15000);
  
  await aiCmd('Run: sudo cp /tmp/zo_nginx.conf /etc/nginx/sites-enabled/default && sudo nginx -t && sudo systemctl reload nginx && echo "NGINX_OK" || echo "NGINX_FAIL"', '应用nginx配置', 20000);

  // ===== 步骤3: 验证 =====
  await aiCmd('Run: curl -s -o /dev/null -w "%{http_code}" localhost/keepalive/', '测试面板', 15000);
  await aiCmd('Run: curl -s localhost/keepalive/api/state 2>/dev/null | head -5 || echo "API_FAIL"', '测试API', 15000);
  await aiCmd('Run: curl -s localhost:3000/api/state 2>/dev/null | head -5 || echo "PANEL_FAIL"', '测试3000', 15000);

  log('\n===== ✅ 完成 =====');
  log('面板: https://builderpcux.zo.computer/keepalive/');
  log('API:  https://builderpcux.zo.computer/keepalive/api/state');
  
  log('\n保持120s...');
  await sleep(120000);
  await context.close();
}

main().catch(e => { log(`错误: ${e.message}`); process.exit(1); });
