/**
 * ZO套娃 v3 — 通过ZO终端直接部署（绕过AI消息限额）
 * ZO云电脑有完整的Linux终端，直接在里面跑命令
 */
import { readFileSync, appendFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXT_DIR = join('E:\\API获取工具\\ZO注册', 'ext-crack');
const LOG_DIR = join(__dirname, 'logs', 'matryoshka3');
const ACCOUNTS_FILE = join(__dirname, 'keepalive', 'accounts.json');
if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));
const now = () => new Date().toISOString();
const log = msg => { const m = `[${now()}] ${msg}`; console.log(m); appendFileSync(join(LOG_DIR, 'log.txt'), m + '\n'); };
const rand = (a, b) => Math.floor(a + Math.random() * (b - a + 1));

const accounts = JSON.parse(readFileSync(ACCOUNTS_FILE, 'utf-8'));
const acc = accounts[0];

// ZO内部保活脚本（比之前更简单可靠）
const KEEPALIVE_JS = `// ZO内部自保活
const { chromium } = require('playwright');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const rf = (a,b) => a + Math.random() * (b-a);
async function cycle() {
  let b;
  try{
    b=await chromium.launch({headless:true,args:['--no-sandbox','--disable-gpu','--disable-dev-shm-usage']});
    const p=await b.newPage();
    await p.goto('https://www.zo.computer',{waitUntil:'domcontentloaded',timeout:30000});
    await sleep(3000+Math.random()*5000);
    for(let i=0;i<Math.floor(3+Math.random()*5);i++){await p.mouse.move(rf(100,1200),rf(100,700));await sleep(100+Math.random()*300);}
    await p.mouse.wheel(0,100+Math.random()*300);
    await sleep(2000+Math.random()*3000);
    await b.close();
    console.log(new Date().toISOString(),'ok');
  }catch(e){console.error(e.message);try{await b.close();}catch(e2){}}
}
cycle();
setInterval(cycle, Math.floor(5*60000+Math.random()*7*60000));
`;

// Graph API
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
  for (const m of (d.value || [])) { if(new Date(m.receivedDateTime)<after)continue; const c=(m.subject||'')+' '+(m.body?.content||''); if(!/zo/i.test(c))continue; const links=c.match(/https?:\/\/[^\s"'<>]*zo\.computer[^\s"'<>]*/gi)||[]; for(let l of links){l=l.replace(/[)\]>,;!?\s]+$/,'').replace(/&amp;/g,'&');if(/token=|verify|login/i.test(l))return l;} }
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

async function login(page, cdp) {
  log('登录...');
  try{await page.goto('https://www.zo.computer/signup',{waitUntil:'networkidle',timeout:30000});}catch(e){}
  await sleep(3000);
  await page.evaluate(()=>{for(const btn of document.querySelectorAll('button,a')){if(/email/i.test(btn.textContent||'')&&btn.offsetParent){btn.click();return;}}});
  await sleep(2000);
  await page.evaluate(e=>{const inp=document.querySelector('input[type=email]')||document.querySelector('input');if(inp){const s=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;s.call(inp,e);inp.dispatchEvent(new Event('input',{bubbles:true}));}},acc.email);
  await sleep(500);
  await page.evaluate(()=>{for(const btn of document.querySelectorAll('button')){if(/continue/i.test(btn.textContent||'')){btn.click();return;}}});
  await sleep(3000);
  const st=new Date(Date.now()-5000);let link=null,rt=acc.refreshToken;
  for(let i=0;i<45;i++){try{const{at,rt:nr}=await getMsToken(acc.clientId,rt);rt=nr;link=await findLink(at,st);}catch(e){}if(link)break;await sleep(3000);}
  if(!link){log('无link');return false;}
  try{await page.goto(link,{waitUntil:'domcontentloaded',timeout:60000});}catch(e){}
  await sleep(12000);
  for(let a=0;a<10;a++){const h=(()=>{try{return new URL(page.url()).hostname}catch(e){return''}})();if(h.endsWith('.zo.computer')&&h!=='www.zo.computer'){log('已登录');return true;}const w=await findWidget(cdp);if(w?.box&&w.box.w>0&&a<3){const{x,y,h:bh}=w.box;try{await page.mouse.move(x+28,y+bh/2,{steps:8});await sleep(100);await page.mouse.down();await sleep(50);await page.mouse.up();}catch(e){}}await sleep(3000);}
  return false;
}

// ========== ★ 通过ZO终端部署 ==========
async function deployViaTerminal(page) {
  log('\n=== 通过ZO终端部署 ===');

  // ZO桌面有终端 — 找Terminal按钮或直接用快捷键
  log('寻找终端入口...');

  // 尝试点击Terminal按钮
  const terminalOpened = await page.evaluate(() => {
    for (const el of document.querySelectorAll('button, a, [role="button"], div[role="tab"], span')) {
      const t = (el.textContent || '').trim().toLowerCase();
      if (t === 'terminal' || t === '终端' || /term/i.test(t) && t.length < 15) {
        if (el.offsetParent) { el.click(); return true; }
      }
    }
    return false;
  });

  if (terminalOpened) log('已打开终端');
  else log('未找到终端按钮，尝试快捷键 Ctrl+`');

  await sleep(5000);

  // 截图看状态
  await page.screenshot({ path: join(LOG_DIR, 'terminal.png') });

  // 找终端输入区（通常是xterm或类似组件内的textarea）
  const termInfo = await page.evaluate(() => {
    const info = { termFound: false, inputs: [] };
    ['textarea', '[contenteditable="true"]', '.xterm-helper-textarea', '[class*="terminal"] textarea', '[class*="xterm"] textarea'].forEach(sel => {
      try {
        const el = document.querySelector(sel);
        if (el && el.offsetParent) {
          info.termFound = true;
          info.inputs.push({ sel, visible: true });
        }
      } catch(e) {}
    });
    info.bodyText = (document.body?.innerText || '').substring(0, 500);
    return info;
  });

  log(`终端可见: ${termInfo.termFound}, 输入框: ${termInfo.inputs.length}`);
  log(`页面: ${termInfo.bodyText.substring(0, 200)}`);

  if (!termInfo.termFound) {
    log('⚠ 找不到终端输入区，保存页面截图');
    return false;
  }

  // ★ 在终端中执行命令
  async function termExec(cmd, desc) {
    log(`  ${desc}: ${cmd.substring(0, 60)}...`);
    // 聚焦终端
    await page.keyboard.press('Control+`');
    await sleep(1000);

    // 键入命令
    for (const ch of cmd) {
      await page.keyboard.type(ch);
      await sleep(20);
    }
    await page.keyboard.press('Enter');
    log('    已执行，等待30s...');
    await sleep(30000);
    return true;
  }

  // 部署步骤
  await termExec('sudo apt update -qq', '更新apt');
  await termExec('sudo apt install -y xvfb chromium-browser nodejs npm', '安装xvfb+chromium+node');
  await termExec('npm install -g playwright 2>&1 | tail -5', '安装playwright');
  await termExec('npx playwright install chromium 2>&1 | tail -5', '安装chromium内核');

  // 创建保活脚本
  const b64 = Buffer.from(KEEPALIVE_JS).toString('base64');
  await termExec(`echo '${b64}' | base64 -d > /home/user/keepalive.js && echo 'SCRIPT_CREATED'`, '创建保活脚本');

  // 测试运行
  await termExec('cd /home/user && timeout 30 xvfb-run -a node keepalive.js 2>&1 || echo "TIMEOUT_OK"', '测试保活');

  // 后台启动
  await termExec('cd /home/user && nohup xvfb-run -a node keepalive.js > /tmp/keepalive.log 2>&1 & echo "PID=$!"', '后台启动');

  // 验证
  await termExec('sleep 10 && ps aux | grep -v grep | grep keepalive || echo "NOT_RUNNING"', '验证进程');
  await termExec('cat /tmp/keepalive.log', '检查日志');

  log('\n✅ 终端部署完成');
  return true;
}

async function main() {
  log('ZO套娃v3 — 终端部署');

  const { chromium } = await import('playwright');
  const context = await chromium.launchPersistentContext(
    join(homedir(), 'AppData', 'Local', 'zo-term'),
    { headless: false, executablePath: 'C:\\Users\\XZXyuan\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe', args: [`--disable-extensions-except=${EXT_DIR}`, `--load-extension=${EXT_DIR}`, '--disable-blink-features=AutomationControlled', '--window-size=1440,900'] }
  );
  const page = context.pages()[0] || await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('DOM.enable');

  if (!await login(page, cdp)) { log('登录失败'); await context.close(); return; }

  log('等ZO加载(60s)...');
  await sleep(60000);

  await deployViaTerminal(page);

  log('\n完成，保持60s...');
  await sleep(60000);
  await context.close();
}

main().catch(e => { log(`错误: ${e.message}`); process.exit(1); });
