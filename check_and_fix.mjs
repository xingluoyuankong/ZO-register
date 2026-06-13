/**
 * 检查ZO状态+部署面板到子域名
 */
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXT_DIR = join(__dirname, 'ext-crack');
const LOG_DIR = join(__dirname, 'logs', 'check');
const ACCOUNTS_FILE = join(__dirname, 'keepalive', 'accounts.json');
if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));
const now = () => new Date().toISOString();
const log = msg => { const m = `[${now()}] ${msg}`; console.log(m); appendFileSync(join(LOG_DIR, 'log.txt'), m + '\n'); };
const rand = (a,b) => Math.floor(a+Math.random()*(b-a+1));
const seval = (page, fn, ...args) => page.evaluate(fn, ...args).catch(e => { log(`  eval warning: ${e.message}`); return null; });

const accounts = JSON.parse(readFileSync(ACCOUNTS_FILE, 'utf-8'));
const acc = accounts[0];
log(`账号: ${acc.email} → ${acc.zoUrl}`);

async function getMsToken(cid, rt) {
  const b = new URLSearchParams({ client_id: cid, grant_type: 'refresh_token', refresh_token: rt, scope: 'https://graph.microsoft.com/.default offline_access' });
  const r = await fetch('https://login.microsoftonline.com/consumers/oauth2/v2.0/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: b.toString() });
  const d = await r.json();
  if (d.error) throw new Error(d.error_description);
  return { at: d.access_token, rt: d.refresh_token || rt };
}
async function findLink(at, after) {
  const r = await fetch('https://graph.microsoft.com/v1.0/me/messages?$top=10&$select=subject,body,receivedDateTime&$orderby=receivedDateTime%20desc', { headers: { Authorization: 'Bearer ' + at } });
  const d = await r.json();
  for (const m of (d.value || [])) { if (new Date(m.receivedDateTime)<after) continue; const c=(m.subject||'')+' '+(m.body?.content||''); if(!/zo/i.test(c)) continue; const links=c.match(/https?:\/\/[^\s"'<>]*zo\.computer[^\s"'<>]*/gi)||[]; for(let l of links){l=l.replace(/[)\]>,;!?\s]+$/,'').replace(/&amp;/g,'&');if(/token=|verify|login/i.test(l))return l;} }
  return null;
}
async function findWidget(cdp) {
  const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
  let r = null;
  (function dfs(n,d){if(r||d>100||!n)return;const t=(n.localName||'').toLowerCase();if(t==='iframe'&&n.attributes){const a=Array.isArray(n.attributes)?n.attributes:[];const i=a.findIndex(x=>x==='src');const s=i>=0?(a[i+1]||''):'';if(s.includes('challenges.cloudflare')||s.includes('turnstile')){r={nodeId:n.nodeId,src:s};return;}}if(n.shadowRoots)for(const sr of n.shadowRoots)dfs(sr,d+1);if(n.children)for(const c of n.children)dfs(c,d+1);if(n.contentDocument)dfs(n.contentDocument,d+1);})(root,0);
  if(!r)return null;
  try{const bm=await cdp.send('DOM.getBoxModel',{nodeId:r.nodeId});if(bm?.model?.content){const c=bm.model.content;r.box={x:c[0],y:c[1],w:c[2]-c[0],h:c[5]-c[1]};}}catch(e){}
  return r;
}

async function main() {
  const { chromium } = await import('playwright');
  const context = await chromium.launchPersistentContext(
    join(homedir(), 'AppData', 'Local', 'zo-check2'),
    { headless: false, executablePath: 'C:\\Users\\XZXyuan\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe', args: [`--disable-extensions-except=${EXT_DIR}`, `--load-extension=${EXT_DIR}`, '--disable-blink-features=AutomationControlled', '--window-size=1440,900'] }
  );
  const page = context.pages()[0] || await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('DOM.enable');

  // ===== 登录 =====
  log('登录ZO...');
  try { await page.goto('https://www.zo.computer/signup', { waitUntil: 'networkidle', timeout: 30000 }); } catch(e) {}
  await sleep(3000);
  await seval(page, () => { for (const btn of document.querySelectorAll('button,a')) { if (/email/i.test(btn.textContent||'') && btn.offsetParent) { btn.click(); return; } } });
  await sleep(2000);
  await seval(page, e => { const inp=document.querySelector('input[type=email]')||document.querySelector('input'); if(inp){ const s=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set; s.call(inp,e); inp.dispatchEvent(new Event('input',{bubbles:true})); } }, acc.email);
  await sleep(500);
  await seval(page, () => { for(const btn of document.querySelectorAll('button')){ if(/continue/i.test(btn.textContent||'')){ btn.click();return; } } });
  await sleep(3000);

  const st=new Date(Date.now()-5000); let link=null, rt=acc.refreshToken;
  for(let i=0;i<60;i++){try{const {at,rt:nr}=await getMsToken(acc.clientId,rt);rt=nr;link=await findLink(at,st);}catch(e){} if(link)break; await sleep(3000); process.stdout.write('.'); }
  if(!link){log('\n无link');await context.close();return;}
  log(`\n✅ link`);

  try{await page.goto(link,{waitUntil:'domcontentloaded',timeout:60000});}catch(e){}
  await sleep(12000);
  for(let a=0;a<10;a++){let host='x';try{host=(()=>{try{return new URL(page.url()).hostname}catch(e){return''}})();}catch(e){} if(host.endsWith('.zo.computer')&&host!=='www.zo.computer'){log(`✅ ${host}`);break;} const w=await findWidget(cdp);if(w?.box&&w.box.w>0&&a<3){const{x,y,h:bh}=w.box;try{await page.mouse.move(x+28,y+bh/2,{steps:8});await sleep(100);await page.mouse.down();await sleep(50);await page.mouse.up();}catch(e){}} await sleep(3000);}

  // ===== 等待ZO加载 + 打开终端 =====
  log('等ZO加载(50s)...');
  await sleep(50000);

  log('Ctrl+` 打开终端...');
  await page.keyboard.press('Control+Backquote');
  await sleep(8000);

  // ★ 直接键盘输入命令（终端打开后光标就在输入区）
  async function termCmd(cmd, desc) {
    log(`[${desc}]`);
    for(const ch of cmd){await page.keyboard.type(ch);await sleep(15);}
    await sleep(500);
    await page.keyboard.press('Enter');
    log('  ✅');
    await sleep(rand(15000,30000));
  }

  // 检查
  log('\n===== 检查状态 =====');
  await termCmd('echo "===STATUS_CHECK===" && date', '时间检查');
  await termCmd('ps aux | grep -v grep | grep keepalive || echo "NOT_RUNNING"', '保活进程');
  await termCmd('tail -10 /tmp/keepalive.log 2>/dev/null || echo "NO_LOG"', '保活日志');
  await termCmd('which xvfb-run chromium-browser node', '依赖检查');

  // ===== 修复+部署 =====
  log('\n===== 部署面板到ZO子域名(80端口) =====');
  await termCmd('sudo pkill -f keepalive.js 2>/dev/null; sleep 2; echo "stopped"', '停止旧进程');
  await termCmd('curl -fsSL -o /home/user/keepalive.js https://raw.githubusercontent.com/xingluoyuankong/ZO-register/master/keepalive_full_puppet.js && echo "DOWNLOADED" || echo "DOWNLOAD_FAILED"', '下载最新脚本');
  await termCmd('cd /home/user && sudo nohup xvfb-run -a node keepalive.js > /tmp/keepalive.log 2>&1 & echo "PID=$!"', '80端口启动');
  await termCmd('sleep 5 && curl -s localhost:80 | head -3', '验证面板');
  await termCmd('ps aux | grep -v grep | grep keepalive', '验证进程');

  log('\n===== ✅ 完成 =====');
  log(`面板: https://${acc.handle}.zo.computer`);
  log(`API: https://${acc.handle}.zo.computer/api/state`);
  log('保持30s...');
  await sleep(30000);
  await context.close();
}

main().catch(e => { log(`错误: ${e.message}`); process.exit(1); });
