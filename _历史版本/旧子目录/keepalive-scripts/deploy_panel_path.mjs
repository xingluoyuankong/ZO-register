/**
 * 把保活面板部署到 ZO子域名/keepalive 路径下
 * 修复：精确聚焦终端输入+粘贴命令替代逐字type
 */
import { readFileSync, appendFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXT_DIR = join('E:\\API获取工具\\ZO注册', 'ext-crack');
const LOG_DIR = join(__dirname, 'logs', 'panel_path');
const ACCOUNTS_FILE = join(__dirname, 'keepalive', 'accounts.json');
if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));
const now = () => new Date().toISOString();
const log = msg => { const m = `[${now()}] ${msg}`; console.log(m); appendFileSync(join(LOG_DIR, 'log.txt'), m + '\n'); };
const rand = (a,b) => Math.floor(a+Math.random()*(b-a+1));
const seval = (page, fn, ...args) => page.evaluate(fn, ...args).catch(e=>{});

const accounts = JSON.parse(readFileSync(ACCOUNTS_FILE, 'utf-8'));
const acc = accounts[0];

async function getMsToken(cid, rt) {
  const b = new URLSearchParams({ client_id: cid, grant_type: 'refresh_token', refresh_token: rt, scope: 'https://graph.microsoft.com/.default offline_access' });
  const r = await fetch('https://login.microsoftonline.com/consumers/oauth2/v2.0/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: b.toString() });
  const d = await r.json(); if (d.error) throw new Error(d.error_description);
  return { at: d.access_token, rt: d.refresh_token || rt };
}
async function findLink(at, after) {
  const r = await fetch('https://graph.microsoft.com/v1.0/me/messages?$top=10&$select=subject,body,receivedDateTime&$orderby=receivedDateTime%20desc', { headers: { Authorization: 'Bearer ' + at } });
  const d = await r.json(); for (const m of (d.value || [])) { if (new Date(m.receivedDateTime)<after) continue; const c=(m.subject||'')+' '+(m.body?.content||''); if(!/zo/i.test(c)) continue; const links=c.match(/https?:\/\/[^\s"'<>]*zo\.computer[^\s"'<>]*/gi)||[]; for(let l of links){l=l.replace(/[)\]>,;!?\s]+$/,'').replace(/&amp;/g,'&');if(/token=|verify|login/i.test(l))return l;} }
  return null;
}
async function findWidget(cdp) {
  const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true }); let r = null;
  (function dfs(n,d){if(r||d>100||!n)return;const t=(n.localName||'').toLowerCase();if(t==='iframe'&&n.attributes){const a=Array.isArray(n.attributes)?n.attributes:[];const i=a.findIndex(x=>x==='src');const s=i>=0?(a[i+1]||''):'';if(s.includes('challenges.cloudflare')||s.includes('turnstile')){r={nodeId:n.nodeId,src:s};return;}}if(n.shadowRoots)for(const sr of n.shadowRoots)dfs(sr,d+1);if(n.children)for(const c of n.children)dfs(c,d+1);if(n.contentDocument)dfs(n.contentDocument,d+1);})(root,0);
  if(!r)return null; try{const bm=await cdp.send('DOM.getBoxModel',{nodeId:r.nodeId});if(bm?.model?.content){const c=bm.model.content;r.box={x:c[0],y:c[1],w:c[2]-c[0],h:c[5]-c[1]};}}catch(e){} return r;
}

async function main() {
  const { chromium } = await import('playwright');
  const context = await chromium.launchPersistentContext(
    join(homedir(), 'AppData', 'Local', 'zo-panel-path'),
    { headless: false, executablePath: 'C:\\Users\\XZXyuan\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe', args: [`--disable-extensions-except=${EXT_DIR}`, `--load-extension=${EXT_DIR}`, '--disable-blink-features=AutomationControlled', '--window-size=1440,900'] }
  );
  const page = context.pages()[0] || await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('DOM.enable');

  // ===== 登录（用持久化session，不用重新发magic link） =====
  log('直接用持久化session登录...');
  
  // 直接打开ZO子域名，session cookie可能还在
  const zoDomain = acc.handle ? `https://${acc.handle}.zo.computer` : 'https://www.zo.computer';
  log(`打开: ${zoDomain}`);
  try { await page.goto(zoDomain, { waitUntil: 'domcontentloaded', timeout: 30000 }); } catch(e) { log(`直接访问失败: ${e.message}`); }
  await sleep(8000);
  
  let host = 'x';
  try { host = (() => { try { return new URL(page.url()).hostname; } catch(e) { return ''; } })(); } catch(e) {}
  
  if (host.endsWith('.zo.computer') && host !== 'www.zo.computer') {
    log(`✅ Session有效: ${host}`);
  } else {
    log(`需要重新登录(当前: ${host})，发magic link...`);
    try { await page.goto('https://www.zo.computer/signup', { waitUntil: 'networkidle', timeout: 30000 }); } catch(e) {}
    await sleep(3000);
    await seval(page, () => { for (const btn of document.querySelectorAll('button,a')) { if (/email/i.test(btn.textContent||'') && btn.offsetParent) { btn.click(); return; } } });
    await sleep(2000);
    await seval(page, e => { const inp=document.querySelector('input[type=email]')||document.querySelector('input'); if(inp){ const s=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set; s.call(inp,e); inp.dispatchEvent(new Event('input',{bubbles:true})); } }, acc.email);
    await sleep(500);
    await seval(page, () => { for(const btn of document.querySelectorAll('button')){ if(/continue/i.test(btn.textContent||'')){ btn.click();return; } } });
    await sleep(3000);

    const st=new Date(Date.now()-5000); let link=null, rt=acc.refreshToken;
    for(let i=0;i<45;i++){try{const {at,rt:nr}=await getMsToken(acc.clientId,rt);rt=nr;link=await findLink(at,st);}catch(e){} if(link)break; await sleep(4000); process.stdout.write('.'); }
    if(!link){log('\n无link，尝试用备用方法...');} else {
      log(`\nlink: ${link.substring(0,60)}...`);
      try{await page.goto(link,{waitUntil:'domcontentloaded',timeout:60000});}catch(e){}
      await sleep(12000);
      for(let a=0;a<10;a++){let h2='x';try{h2=(()=>{try{return new URL(page.url()).hostname}catch(e){return''}})();}catch(e){} if(h2.endsWith('.zo.computer')&&h2!=='www.zo.computer'){log(`✅ 已登录: ${h2}`);break;} const w=await findWidget(cdp);if(w?.box&&w.box.w>0&&a<3){const{x,y,h:bh}=w.box;try{await page.mouse.move(x+28,y+bh/2,{steps:8});await sleep(100);await page.mouse.down();await sleep(50);await page.mouse.up();}catch(e){}} await sleep(3000);}
    }
  }

  // ===== 等待ZO完全加载 =====
  log('等待ZO桌面完全加载(60s)...');
  await sleep(60000);

  // ===== 打开终端（精确方法） =====
  // ZO的终端是通过xterm.js渲染的，在页面某个区域
  // 方法1: Ctrl+` 快捷键
  log('打开终端...');
  await page.keyboard.press('Control+Backquote');
  await sleep(10000);

  // ★ 关键修复：点击终端区域确保聚焦
  // 终端区域通常在页面下半部分或底部面板
  // 先截图看看终端在哪里
  try { await page.screenshot({ path: join(LOG_DIR, 'terminal_open.png') }); } catch(e){}
  
  // 终端输入在 xterm 的 textarea 或者直接通过键盘事件发送
  // xterm.js 通常有一个隐藏的 textarea 用于输入
  const terminalFocused = await page.evaluate(() => {
    // 找 xterm 的 textarea
    const xtermTextarea = document.querySelector('.xterm-helper-textarea') || document.querySelector('textarea[aria-label]');
    if (xtermTextarea) {
      xtermTextarea.focus();
      xtermTextarea.click();
      return 'xterm-textarea';
    }
    // 找任何可见的 textarea
    for (const ta of document.querySelectorAll('textarea')) {
      if (ta.offsetParent !== null) {
        ta.focus(); ta.click();
        return 'textarea-visible';
      }
    }
    // 尝试点击终端面板区域
    const termPanel = document.querySelector('[class*="terminal" i]') || document.querySelector('[class*="xterm" i]');
    if (termPanel) { termPanel.click(); return 'terminal-panel'; }
    return 'none';
  });
  log(`  终端聚焦: ${terminalFocused}`);
  await sleep(2000);

  // ★ 核心：发送命令到终端（通过剪贴板粘贴，比逐字type可靠100倍）
  async function term(cmd, desc, waitMs = 25000) {
    log(`[${desc}]`);
    
    // 每次执行前先确保终端聚焦
    await page.evaluate(() => {
      const ta = document.querySelector('.xterm-helper-textarea') || document.querySelector('textarea[aria-label]');
      if (ta) { ta.focus(); ta.click(); return; }
      for (const t of document.querySelectorAll('textarea')) { if (t.offsetParent) { t.focus(); t.click(); return; } }
    });
    await sleep(500);

    // 用剪贴板粘贴命令
    await page.evaluate(c => navigator.clipboard.writeText(c), cmd);
    await sleep(300);
    await page.keyboard.press('Control+v');
    await sleep(800);
    await page.keyboard.press('Enter');
    log(`  已发送(${cmd.length}字符)`);
    await sleep(waitMs);
  }

  // ===== 先看ZO的端口和进程结构 =====
  await term('echo "=== NETSTAT ===" && sudo netstat -tlnp 2>/dev/null | head -25 || ss -tlnp | head -25', '端口全景', 20000);
  await term('echo "=== PS ===" && ps aux | grep -E "node|next|nginx|serve" | grep -v grep | head -15', '进程结构', 20000);
  await term('echo "=== LS ===" && ls -la /etc/nginx/sites-enabled/ 2>/dev/null || echo "no nginx dir"', 'nginx配置', 15000);

  // ===== 第一步：杀掉旧保活 =====
  await term('sudo pkill -9 -f keepalive.js 2>/dev/null; sleep 2; echo "CLEAN"', '杀旧保活');

  // ===== 第二步：下载最新保活脚本 =====
  await term('curl -fsSL -o /home/user/keepalive.js https://raw.githubusercontent.com/xingluoyuankong/ZO-register/master/keepalive_full_puppet.js && echo "DOWNLOADED"', '下载保活');

  // ===== 第三步：启动保活(3000端口) =====
  await term('cd /home/user && nohup xvfb-run -a node keepalive.js > /tmp/keepalive.log 2>&1 & echo "STARTED_PID=$!"', '启动保活');

  // ===== 第四步：验证保活启动 =====
  await term('sleep 15 && ps aux | grep -v grep | grep keepalive && echo "RUNNING" || echo "NOT_RUNNING"', '验证保活进程');
  await term('curl -s localhost:3000 | head -5 || echo "PANEL_NOT_READY"', '验证3000面板');

  // ===== 第五步：查ZO用什么服务80端口，配置nginx =====
  log('\n===== 配置nginx反向代理 =====');
  
  // 先看看80端口是谁在管
  await term('sudo netstat -tlnp | grep ":80 "', '80端口占用');

  // 安装nginx
  await term('which nginx || (sudo apt update -qq && sudo apt install -y nginx) && echo "NGINX_READY"', '安装nginx');

  // 写入nginx配置（把/keepalive反向代理到3000，其余透传给ZO桌面）
  const nginxConf = [
    'server {',
    '    listen 80 default_server;',
    '    server_name _;',
    '    # 保活面板',
    '    location /keepalive/ {',
    '        proxy_pass http://127.0.0.1:3000/;',
    '        proxy_set_header Host $host;',
    '    }',
    '    location /keepalive { return 301 /keepalive/; }',
    '    # ZO桌面 - 需要先查出ZO的实际端口',
    '    # 默认先试8080',
    '    location / {',
    '        proxy_pass http://127.0.0.1:8080;',
    '        proxy_set_header Host $host;',
    '        proxy_set_header X-Real-IP $remote_addr;',
    '        proxy_http_version 1.1;',
    '        proxy_set_header Upgrade $http_upgrade;',
    '        proxy_set_header Connection "upgrade";',
    '    }',
    '}',
  ].join('\\n');
  
  const nginxB64 = Buffer.from(nginxConf).toString('base64');
  await term(`echo '${nginxB64}' | base64 -d | sudo tee /etc/nginx/sites-enabled/default > /dev/null && echo "CONF_WRITTEN"`, '写nginx配置');
  await term('sudo nginx -t && sudo systemctl reload nginx && echo "NGINX_OK" || echo "NGINX_FAIL"', '重载nginx', 30000);

  // ===== 第六步：验证 =====
  await term('curl -s -o /dev/null -w "%{http_code}" localhost/keepalive/', '测试面板HTTP码');
  await term('curl -s localhost/keepalive/api/state | head -20 || echo "API_FAIL"', '测试面板API');

  log('\n===== ✅ 部署完成 =====');
  log('保活面板: https://builderpcux.zo.computer/keepalive/');
  log('保活API:  https://builderpcux.zo.computer/keepalive/api/state');
  log('ZO桌面:   https://builderpcux.zo.computer (正常使用)');
  log('\n保持120s后关闭...');
  await sleep(120000);
  await context.close();
  log('完成');
}

main().catch(e => { log(`错误: ${e.message}`); console.error(e); process.exit(1); });
