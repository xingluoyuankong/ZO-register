/**
 * ZO 终极部署 — 登录→终端→一次性部署保活+面板
 * 
 * 修复：先点击终端区域聚焦，再用Ctrl+V粘贴命令
 */
import { readFileSync, appendFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXT_DIR = join('E:\\API获取工具\\ZO注册', 'ext-crack');
const LOG_DIR = join(__dirname, 'logs', 'final_deploy');
const ACCOUNTS_FILE = join(__dirname, 'keepalive', 'accounts.json');
if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));
const now = () => new Date().toISOString();
const log = msg => { const m = `[${now()}] ${msg}`; console.log(m); appendFileSync(join(LOG_DIR, 'log.txt'), m + '\n'); };
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
    join(homedir(), 'AppData', 'Local', 'zo-final'),
    { headless: false, executablePath: 'C:\\Users\\XZXyuan\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe', args: [`--disable-extensions-except=${EXT_DIR}`, `--load-extension=${EXT_DIR}`, '--disable-blink-features=AutomationControlled', '--window-size=1440,900'] }
  );
  const page = context.pages()[0] || await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('DOM.enable');

  // ===== 登录 =====
  log('登录...');
  try { await page.goto(acc.zoUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }); } catch(e) {}
  await sleep(8000);
  let host = 'x'; try { host = (() => { try { return new URL(page.url()).hostname; } catch(e) { return ''; } })(); } catch(e) {}
  
  if (!host.endsWith('.zo.computer') || host === 'www.zo.computer') {
    log(`需要重新登录(当前:${host})`);
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
    if(!link){log('\n❌ 无magic link');await context.close();return;}
    log(`\n✅ link`);
    try{await page.goto(link,{waitUntil:'domcontentloaded',timeout:60000});}catch(e){}
    await sleep(12000);
    for(let a=0;a<10;a++){let h2='x';try{h2=(()=>{try{return new URL(page.url()).hostname}catch(e){return''}})();}catch(e){} if(h2.endsWith('.zo.computer')&&h2!=='www.zo.computer'){log(`✅ 登录成功: ${h2}`);host=h2;break;} const w=await findWidget(cdp);if(w?.box&&w.box.w>0&&a<3){const{x,y,h:bh}=w.box;try{await page.mouse.move(x+28,y+bh/2,{steps:8});await sleep(100);await page.mouse.down();await sleep(50);await page.mouse.up();}catch(e){}} await sleep(3000);}
  } else {
    log(`✅ Session有效: ${host}`);
  }

  if (!host.endsWith('.zo.computer') || host === 'www.zo.computer') { log('❌ 未登录ZO子域名'); await context.close(); return; }

  // ===== 等待ZO桌面加载 =====
  log('等待ZO桌面(60s)...');
  await sleep(60000);

  // ===== 打开终端 =====
  log('打开终端...');
  // 方法1: 先找终端按钮点
  await page.evaluate(() => {
    for (const el of document.querySelectorAll('button, a, [role="button"], div[role="tab"], span')) {
      const t = (el.textContent || '').trim().toLowerCase();
      if ((t === 'terminal' || t === '终端') && el.offsetParent) { el.click(); return; }
    }
  });
  await sleep(3000);
  // 方法2: 快捷键
  await page.keyboard.press('Control+Backquote');
  await sleep(10000);

  // ★ 关键：点击终端区域确保聚焦
  log('聚焦终端...');
  await page.evaluate(() => {
    // 找xterm的textarea
    const ta = document.querySelector('.xterm-helper-textarea') || document.querySelector('textarea[aria-label]');
    if (ta) { ta.focus(); ta.click(); return; }
    // 找终端面板区域
    const panel = document.querySelector('[class*="terminal" i]') || document.querySelector('[class*="xterm" i]') || document.querySelector('[class*="shell" i]');
    if (panel) { panel.click(); }
  });
  await sleep(2000);

  try { await page.screenshot({ path: join(LOG_DIR, 'terminal.png') }); } catch(e){}

  // ★ 剪贴板粘贴命令（一次性全部完成）
  async function pasteCmd(cmd, desc, waitSec = 25) {
    log(`[${desc}] ${cmd.substring(0, 60)}...`);
    // 确保聚焦
    await page.evaluate(() => {
      const ta = document.querySelector('.xterm-helper-textarea') || document.querySelector('textarea[aria-label]');
      if (ta) { ta.focus(); ta.click(); }
    });
    await sleep(500);
    // 粘贴
    await page.evaluate(c => navigator.clipboard.writeText(c), cmd);
    await sleep(300);
    await page.keyboard.press('Control+v');
    await sleep(800);
    await page.keyboard.press('Enter');
    log(`  ✅ 已粘贴(${cmd.length}字符)`);
    await sleep(waitSec * 1000);
  }

  // ===== 一次性部署 =====
  log('\n===== 开始部署 =====');
  
  // 1. 安装依赖
  await pasteCmd('sudo apt update -qq && sudo apt install -y xvfb chromium-browser nodejs npm 2>&1 | tail -3 && echo "===DEPS_OK==="', '安装依赖', 60);

  // 2. 安装playwright
  await pasteCmd('npm install -g playwright 2>&1 | tail -3 && npx playwright install chromium 2>&1 | tail -3 && echo "===PW_OK==="', '安装playwright', 90);

  // 3. 杀掉旧保活
  await pasteCmd('sudo pkill -9 -f keepalive.js 2>/dev/null; sudo fuser -k 80/tcp 2>/dev/null; sleep 2; echo "===CLEAN==="', '清理旧进程', 15);

  // 4. 下载保活脚本
  await pasteCmd('curl -fsSL -o /home/user/keepalive.js https://raw.githubusercontent.com/xingluoyuankong/ZO-register/master/keepalive_full_puppet.js && echo "===DOWNLOADED==="', '下载保活', 15);

  // 5. 启动保活(3000端口，不占80)
  await pasteCmd('cd /home/user && nohup xvfb-run -a node keepalive.js > /tmp/keepalive.log 2>&1 & echo "===STARTED_PID=$!==="', '启动保活', 20);

  // 6. 验证保活
  await pasteCmd('sleep 15 && ps aux | grep -v grep | grep keepalive && echo "===RUNNING===" || echo "===NOT_RUNNING==="', '验证进程', 20);

  // 7. 验证面板(本地)
  await pasteCmd('sleep 5 && curl -s localhost:3000 | head -3 || echo "===PANEL_FAIL==="', '验证面板', 15);

  // 8. 查看日志
  await pasteCmd('cat /tmp/keepalive.log | tail -10', '查看日志', 10);

  log('\n===== ✅ 部署完成 =====');
  log('保活在ZO内部3000端口运行');
  log('ZO终端查看: curl localhost:3000');
  log('ZO终端API: curl localhost:3000/api/state');
  log('保持120s后关闭...');
  await sleep(120000);
  await context.close();
  log('完成');
}

main().catch(e => { log(`错误: ${e.message}`); console.error(e); process.exit(1); });
