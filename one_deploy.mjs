/**
 * ZO 一键部署 — 登录→开终端→curl setup.sh | bash 一条命令搞定
 * 不用逐字打命令，不用剪贴板粘贴，一条curl全搞定
 */
import { readFileSync, appendFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXT_DIR = join(__dirname, 'ext-crack');
const LOG_DIR = join(__dirname, 'logs', 'onedep');
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

// ★ 在终端里的textarea逐字输入（最简单可靠的方式）
async function terminalTypeCmd(page, cmd) {
  try {
    // 找xterm的textarea
    const ta = await page.$('.xterm-helper-textarea');
    if (ta) {
      await ta.focus();
      await ta.click();
    } else {
      const anyTa = await page.$('textarea');
      if (anyTa) { await anyTa.focus(); await anyTa.click(); }
    }
    await sleep(300);
  } catch(e) {
    log(`  聚焦失败: ${e.message}`);
    return;
  }
  
  // 逐字输入
  for (const ch of cmd) {
    try {
      await page.keyboard.type(ch);
      await sleep(10);
    } catch(e) {
      log(`  输入中断: ${e.message}`);
      return;
    }
  }
  await sleep(500);
  try { await page.keyboard.press('Enter'); } catch(e) {}
}

async function main() {
  const { chromium } = await import('playwright');
  const context = await chromium.launchPersistentContext(
    join(homedir(), 'AppData', 'Local', 'zo-onedep2'),
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
    for(let a=0;a<10;a++){let h2='x';try{h2=(()=>{try{return new URL(page.url()).hostname}catch(e){return''}})();}catch(e){} if(h2.endsWith('.zo.computer')&&h2!=='www.zo.computer'){log(`✅ 登录: ${h2}`);host=h2;break;} const w=await findWidget(cdp);if(w?.box&&w.box.w>0&&a<3){const{x,y,h:bh}=w.box;try{await page.mouse.move(x+28,y+bh/2,{steps:8});await sleep(100);await page.mouse.down();await sleep(50);await page.mouse.up();}catch(e){}} await sleep(3000);}
  } else {
    log(`✅ Session有效: ${host}`);
  }

  if (!host.endsWith('.zo.computer') || host === 'www.zo.computer') { log('❌ 未登录'); await context.close(); return; }

  // ===== 等待ZO桌面 =====
  log('等待ZO桌面(60s)...');
  let zoHost = host;
  await sleep(60000);

  // ===== 打开终端 =====
  log('打开终端(Ctrl+`)...');
  try {
    const currentUrl = page.url();
    log(`  当前页面: ${currentUrl.substring(0, 60)}`);
    await page.keyboard.press('Control+Backquote');
    await sleep(10000);
  } catch(e) {
    log(`  终端打开失败: ${e.message}，重导航...`);
    try { await page.goto(`https://${zoHost}`, { waitUntil: 'domcontentloaded', timeout: 30000 }); } catch(e2) {}
    await sleep(15000);
    try { await page.keyboard.press('Control+Backquote'); } catch(e3) {}
    await sleep(5000);
  }

  // ===== ★ 核心：一条命令部署 =====
  const SETUP_CMD = 'curl -fsSL https://raw.githubusercontent.com/xingluoyuankong/ZO-register/master/setup.sh | bash';

  log(`\n执行部署: ${SETUP_CMD}`);
  await terminalTypeCmd(page, SETUP_CMD);
  log('等待执行(120s)...');
  await sleep(120000);

  // ===== 验证 =====
  log('\n验证...');
  await terminalTypeCmd(page, 'ps aux | grep -v grep | grep keepalive && echo RUNNING || echo NOT_RUNNING');
  await sleep(10000);
  await terminalTypeCmd(page, 'curl -s localhost:3000/api/state | head -20');
  await sleep(10000);
  await terminalTypeCmd(page, 'cat /tmp/keepalive.log | tail -5');
  await sleep(10000);

  log('\n===== ✅ 部署完成 =====');
  log('Panel: curl localhost:3000');
  log('API:   curl localhost:3000/api/state');
  log('Log:   cat /tmp/keepalive.log');
  
  await sleep(60000);
  await context.close();
  log('完成');
}

main().catch(e => { log(`错误: ${e.message}`); console.error(e); process.exit(1); });
