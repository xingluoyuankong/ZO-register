/**
 * 验证ZO套娃部署状态 — 登录后读取ZO AI的回复
 */
import { readFileSync, appendFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXT_DIR = join(__dirname, 'ext-crack');
const LOG_DIR = join(__dirname, 'logs', 'verify_deploy');
const ACCOUNTS_FILE = join(__dirname, 'keepalive', 'accounts.json');
if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));
const now = () => new Date().toISOString();
const log = msg => { const m = `[${now()}] ${msg}`; console.log(m); appendFileSync(join(LOG_DIR, 'log.txt'), m + '\n'); };

const accounts = JSON.parse(readFileSync(ACCOUNTS_FILE, 'utf-8'));
const acc = accounts[0];

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
  for (const m of (d.value || [])) { if (new Date(m.receivedDateTime) < after) continue; const c = (m.subject||'')+' '+(m.body?.content||''); if (!/zo/i.test(c)) continue; const links = c.match(/https?:\/\/[^\s"'<>]*zo\.computer[^\s"'<>]*/gi)||[]; for (let l of links) { l = l.replace(/[)\]>,;!?\s]+$/,'').replace(/&amp;/g,'&'); if (/token=|verify|login/i.test(l)) return l; } }
  return null;
}
async function findWidget(cdp) {
  const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
  let r = null;
  (function dfs(n, d) { if (r || d > 100 || !n) return; const t = (n.localName||'').toLowerCase(); if (t === 'iframe' && n.attributes) { const a=Array.isArray(n.attributes)?n.attributes:[]; const i=a.findIndex(x=>x==='src'); const s=i>=0?(a[i+1]||''):''; if(s.includes('challenges.cloudflare')||s.includes('turnstile')){r={nodeId:n.nodeId,src:s};return;} } if(n.shadowRoots)for(const sr of n.shadowRoots)dfs(sr,d+1); if(n.children)for(const c of n.children)dfs(c,d+1); if(n.contentDocument)dfs(n.contentDocument,d+1); })(root,0);
  if(!r)return null;
  try{const bm=await cdp.send('DOM.getBoxModel',{nodeId:r.nodeId});if(bm?.model?.content){const c=bm.model.content;r.box={x:c[0],y:c[1],w:c[2]-c[0],h:c[5]-c[1]};}}catch(e){}
  return r;
}

async function main() {
  log('验证套娃部署');

  const { chromium } = await import('playwright');
  const context = await chromium.launchPersistentContext(
    join(homedir(),'AppData','Local','zo-verify'),
    { headless: false, executablePath: 'C:\\Users\\XZXyuan\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe', args: [`--disable-extensions-except=${EXT_DIR}`,`--load-extension=${EXT_DIR}`,'--disable-blink-features=AutomationControlled','--window-size=1440,900'] }
  );
  const page = context.pages()[0] || await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('DOM.enable');

  // ===== 登录 =====
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
  if(!link){log('无link');await context.close();return;}
  try{await page.goto(link,{waitUntil:'domcontentloaded',timeout:60000});}catch(e){}
  await sleep(12000);
  for(let a=0;a<10;a++){const h=(()=>{try{return new URL(page.url()).hostname}catch(e){return''}})();if(h.endsWith('.zo.computer')&&h!=='www.zo.computer'){log('已登录');break;}const w=await findWidget(cdp);if(w?.box&&w.box.w>0&&a<3){const{x,y,h:bh}=w.box;try{await page.mouse.move(x+28,y+bh/2,{steps:8});await sleep(100);await page.mouse.down();await sleep(50);await page.mouse.up();}catch(e){}}await sleep(3000);}

  // ===== 等待ZO加载 =====
  log('等ZO加载(30s)...');
  await sleep(30000);

  // ===== 发送验证命令并读取AI回复 =====
  async function askAndRead(cmd) {
    log(`\n发送: "${cmd.substring(0,80)}"`);

    // 先记录当前页面文字
    const before = await page.evaluate(()=>document.body?.innerText?.substring(0,200)||'');
    
    // 找输入框
    const found = await page.evaluate(()=>{
      for(const sel of ['textarea','[contenteditable="true"]','[role="textbox"]','input[type="text"]:not([type="hidden"])']){
        const el=document.querySelector(sel);if(el&&el.offsetParent){el.focus();el.click();return sel;}
      }
      return null;
    });
    if(!found){log('  无输入框');return null;}
    
    // 键入
    for(const ch of cmd){await page.keyboard.type(ch);await sleep(20);}
    await sleep(500);
    await page.keyboard.press('Enter');
    
    // ★ 等待AI回复并抓取（轮询body变化）
    log('  等待AI回复...');
    let lastText = before;
    for(let i=0;i<30;i++){
      await sleep(3000);
      try{
        const text = await page.evaluate(()=>document.body?.innerText?.substring(0,1000)||'');
        if(text !== lastText && text.length > lastText.length){
          // 找到新增内容
          log(`  AI回复(100秒内): ${text.substring(lastText.length, lastText.length+300)}`);
          return text;
        }
        lastText = text;
      }catch(e){}
    }
    log('  超时未收到回复');
    return null;
  }

  // 验证1: 检查xvfb是否安装
  await askAndRead('which xvfb-run && echo "XVFB_OK" || echo "XVFB_MISSING"');
  
  // 验证2: 检查chromium
  await askAndRead('which chromium-browser || which chromium || which google-chrome || echo "CHROME_MISSING"');
  
  // 验证3: 检查keepalive进程
  await askAndRead('ps aux | grep keepalive | grep -v grep || echo "NO_PROCESS"');

  // 验证4: 检查日志
  await askAndRead('cat /tmp/keepalive.log 2>/dev/null || echo "NO_LOG"');

  log('\n验证完成。保持30s...');
  await sleep(30000);
  await context.close();
}

main().catch(e=>{log(`错误:${e.message}`);process.exit(1);});
