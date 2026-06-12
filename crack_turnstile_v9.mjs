/**
 * Turnstile v9.0 — 持久化Profile + 真实指纹 + CDP点击
 * 
 * 关键发现：token永远不生成 = Cloudflare判定浏览器为bot
 * 解决：持久化用户目录、消除所有自动化痕迹
 */
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOG_DIR = join(__dirname, 'logs', 'crack_v9');
const EMAIL_FILE = 'C:\\Users\\XZXyuan\\Downloads\\批量注册邮箱\\已经使用\\sanchezquinncu3w1kkhtuc74@outlook.com.txt';
const PROFILE_DIR = join(homedir(), 'AppData', 'Local', 'zo-turnstile-profile');

if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });
if (!existsSync(PROFILE_DIR)) mkdirSync(PROFILE_DIR, { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));
const now = () => new Date().toISOString();
const log = msg => { const m = `[${now()}] ${msg}`; console.log(m); appendFileSync(join(LOG_DIR, 'log.txt'), m + '\n'); };
const rand = (a,b) => a + Math.random() * (b-a);

const emailContent = readFileSync(EMAIL_FILE, 'utf-8').trim();
const [EMAIL, PASSWORD, CLIENT_ID, REFRESH_TOKEN] = emailContent.split('----').map(s=>s.trim());

// ★ 超精简补丁：只做最关键的两个修复
const FINGERPRINT_PATCH = `
;(function() {
  if (window.__V9_PATCHED__) return;
  window.__V9_PATCHED__ = true;

  // 1. webdriver
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined, configurable: true });
  try {
    const d = Object.getOwnPropertyDescriptor(Navigator.prototype, 'webdriver');
    if (d) Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false, configurable: true });
  } catch(e) {}

  // 2. outerWidth/outerHeight 修复（关键！）
  // Turnstile 检测 outerWidth === innerWidth 判定为 headless
  Object.defineProperty(window, 'outerWidth', { 
    get: function() { return window.innerWidth + (window.screenLeft > 0 ? 16 : 0) + Math.floor(Math.random() * 2); },
    configurable: true
  });
  Object.defineProperty(window, 'outerHeight', { 
    get: function() { return window.innerHeight + 80 + Math.floor(Math.random() * 5); },
    configurable: true
  });
  
  // 3. screenX/screenY 修复
  // 仅在主页面应用（不在 Cloudflare iframe 中）
  if (window.top === window) {
    Object.defineProperty(window, 'screenX', { get: function() { return 10 + Math.floor(Math.random() * 50); }, configurable: true });
    Object.defineProperty(window, 'screenY', { get: function() { return 10 + Math.floor(Math.random() * 30); }, configurable: true });
  }

  // 4. plugins 修复
  const origPlugins = navigator.plugins;
  if (!origPlugins || origPlugins.length === 0) {
    Object.defineProperty(navigator, 'plugins', {
      get: function() {
        const arr = [
          { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', length: 1 },
          { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', length: 1 },
          { name: 'Native Client', filename: 'internal-nacl-plugin', length: 1 },
        ];
        arr.item = i => arr[i]; arr.namedItem = n => arr.find(p => p.name === n);
        return arr;
      },
      configurable: true
    });
  }

  // 5. languages
  Object.defineProperty(navigator, 'languages', { get: () => ['zh-CN', 'zh', 'en-US', 'en'], configurable: true });
  
  // 6. platform
  Object.defineProperty(navigator, 'platform', { get: () => 'Win32', configurable: true });

  console.log('[V9 Fingerprint] patches applied');
})();
`;

async function getMagicLink() {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: false, args:['--window-size=1440,900'] });
  const ctx = await browser.newContext({ viewport:{width:1440,height:900}, userAgent:'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/137.0.0.0 Safari/537.36', locale:'zh-CN' });
  const p = await ctx.newPage();
  try { await p.goto('https://www.zo.computer/signup', {waitUntil:'networkidle',timeout:30000}); } catch(e){}
  await sleep(3000);
  await p.evaluate(()=>{ for(const btn of document.querySelectorAll('button,a')){ if(/email/i.test(btn.textContent||'')&&btn.offsetParent){ btn.click(); return; } } });
  await sleep(2000);
  await p.evaluate(email=>{ const inp=document.querySelector('input[type=email]')||document.querySelector('input'); if(inp){ const s=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set; s.call(inp,email); inp.dispatchEvent(new Event('input',{bubbles:true})); } }, EMAIL);
  await sleep(500);
  await p.evaluate(()=>{ for(const btn of document.querySelectorAll('button')){ if(/continue/i.test(btn.textContent||'')){ btn.click(); return; } } });
  await sleep(3000);
  const sendTime=new Date(Date.now()-3000);
  let link=null, rt=REFRESH_TOKEN;
  for(let i=0;i<30;i++){
    try{
      const body=new URLSearchParams({client_id:CLIENT_ID,grant_type:'refresh_token',refresh_token:rt,scope:'https://graph.microsoft.com/.default offline_access'});
      const tr=await fetch('https://login.microsoftonline.com/consumers/oauth2/v2.0/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:body.toString()});
      const td=await tr.json(); if(td.error){await sleep(3000);continue;}
      rt=td.refresh_token||rt;
      const mr=await fetch('https://graph.microsoft.com/v1.0/me/messages?$top=10&$select=subject,body,receivedDateTime&$orderby=receivedDateTime%20desc',{headers:{Authorization:'Bearer '+td.access_token}});
      const md=await mr.json();
      for(const msg of (md.value||[])){ if(new Date(msg.receivedDateTime)<sendTime)continue; const c=(msg.subject||'')+' '+(msg.body?.content||''); if(!/zo/i.test(c))continue; const links=c.match(/https?:\/\/[^\s"'<>]*zo\.computer[^\s"'<>]*/gi)||[]; for(let l of links){l=l.replace(/[)\]>,;!?\s]+$/,'').replace(/&amp;/g,'&'); if(/token=|verify|login/i.test(l)){link=l;break;}} if(link)break; }
    }catch(e){}
    if(link)break; process.stdout.write('.'); await sleep(3000);
  }
  await p.close();await ctx.close();await browser.close();
  if(!link)throw new Error('No link');
  if(rt!==REFRESH_TOKEN)writeFileSync(EMAIL_FILE,[EMAIL,PASSWORD,CLIENT_ID,rt].join('----'),'utf-8');
  return link;
}

// ========== CDP找widget ==========
async function getTurnstileBox(cdp) {
  const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
  let best = null;
  function dfs(node,d) { if(d>80||!node||best)return; const t=(node.localName||'').toLowerCase(); if(t==='iframe'&&node.attributes){ const a=Array.isArray(node.attributes)?node.attributes:[]; const si=a.findIndex(x=>x==='src'); const s=si>=0?(a[si+1]||''):''; if(s.includes('challenges.cloudflare')||s.includes('turnstile')){ best={nodeId:node.nodeId,src:s};return; } } if(node.shadowRoots)for(const sr of node.shadowRoots)dfs(sr,d+1); if(node.children)for(const c of node.children)dfs(c,d+1); if(node.contentDocument)dfs(node.contentDocument,d+1); }
  dfs(root,0);
  if(!best)return null;
  try{ const bm=await cdp.send('DOM.getBoxModel',{nodeId:best.nodeId}); if(bm?.model?.content){ const c=bm.model.content; best.box={x:c[0],y:c[1],w:c[2]-c[0],h:c[5]-c[1]}; } }catch(e){}
  return best;
}

// ========== 自然人点击 ==========
async function naturalClick(page, box) {
  if(!box?.box)return;
  const {x,y,w,h}=box.box;
  const spots = [
    {dx:28,dy:h/2},{dx:26,dy:h*0.48},{dx:30,dy:h*0.52},{dx:28,dy:h*0.45},{dx:28,dy:h*0.55}
  ];
  for(const sp of spots){
    const cx=x+sp.dx, cy=y+sp.dy;
    const sx=cx+rand(60,150)*(Math.random()>.5?1:-1), sy=cy+rand(30,80)*(Math.random()>.5?1:-1);
    const st=Math.floor(rand(5,8));
    for(let s=1;s<=st;s++){ const p=s/st; await page.mouse.move(sx+(cx-sx)*p+Math.sin(p*Math.PI*1.5)*rand(-6,6),sy+(cy-sy)*p+Math.cos(p*Math.PI)*rand(-4,4)); await sleep(rand(15,40)); }
    await sleep(rand(40,120)); await page.mouse.move(cx,cy); await sleep(rand(30,80));
    await page.mouse.down(); await sleep(rand(25,60)); await page.mouse.up();
    log(`   点击 (${Math.round(cx)},${Math.round(cy)})`);
    const t=await page.evaluate(()=>{try{return turnstile.getResponse();}catch(e){return null;}});
    if(t&&t.length>20){log(`   ✅ Token!`);return true;}
    await sleep(rand(500,1200));
  }
  return false;
}

// ========== 主流程 ==========
async function main() {
  log('='.repeat(60));
  log('Turnstile 破解 v9.0 — 持久化Profile + 指纹消除');
  log('='.repeat(60));

  log('\n获取 magic link...');
  const magicLink = await getMagicLink();
  log(`✅ link`);

  const { chromium } = await import('playwright');
  
  // ★ 使用持久化用户目录
  log(`\n使用持久化Profile: ${PROFILE_DIR}`);
  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--window-size=1440,900',
      '--no-sandbox',
      '--disable-features=TranslateUI',
      '--disable-ipc-flooding-protection',
    ],
    viewport: { width: 1440, height: 900 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    colorScheme: 'light',
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: false,
    permissions: [],
  });

  // ★ 注入指纹补丁
  await context.addInitScript({ content: FINGERPRINT_PATCH });

  const page = context.pages()[0] || await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('DOM.enable');

  // 先访问一下正常网站，建立cookie缓存
  log('预热浏览...');
  try { await page.goto('https://www.cloudflare.com/favicon.ico', { waitUntil: 'load', timeout: 10000 }); } catch(e) {}
  await sleep(1000);

  // 主循环
  let solved=false, attempt=0, didClick=false;
  
  while(!solved && attempt < 30) {
    attempt++;
    log(`\n=== 尝试 ${attempt} ===`);

    const url=page.url();
    const hostname=(()=>{try{return new URL(url).hostname}catch(e){return ''}})();
    if(hostname.endsWith('.zo.computer')&&hostname!=='www.zo.computer'){log('🎉 子域名！');solved=true;break;}

    if(!url.includes('/verify') && attempt===1){
      log('导航到 magic link...');
      try{await page.goto(magicLink,{waitUntil:'domcontentloaded',timeout:60000});}catch(e){}
      await sleep(12000);
      await page.screenshot({path:join(LOG_DIR,'01_navigated.png')});
    }

    // 检查token
    const token = await page.evaluate(()=>{try{const r=turnstile.getResponse();return r&&r.length>10?r:null;}catch(e){return null;}});
    if(token){log(`✅ Token: ${token.substring(0,40)}...`); solved=true; break; }

    const text = await page.evaluate(()=>document.body?.innerText?.substring(0,300)||'');
    log(`页面: ${text.substring(0,150)}`);
    if(/choose your handle|set up your profile|welcome|dashboard/i.test(text)){log('🎉 注册流程！');solved=true;break;}
    if(/invalid|expired/i.test(text)&&!/redirecting/i.test(text)){
      log('⚠ Expired, 重新导航...');
      try{await page.goto(magicLink,{waitUntil:'domcontentloaded',timeout:30000});}catch(e){}
      await sleep(12000); didClick=false; continue;
    }

    // 找widget
    const box = await getTurnstileBox(cdp);
    if(box?.box){
      log(`Widget: (${Math.round(box.box.x)},${Math.round(box.box.y)}) ${Math.round(box.box.w)}x${Math.round(box.box.h)}`);
      
      if(!didClick){
        log('模拟浏览...');
        for(let i=0;i<5;i++){await page.mouse.move(rand(200,900),rand(100,700),{steps:Math.floor(rand(4,8))});await sleep(rand(200,500));}
        await page.mouse.wheel(0,rand(50,150));await sleep(rand(400,800));
        await page.screenshot({path:join(LOG_DIR,'02_before.png')});
        log('点击...');
        await naturalClick(page, box);
        await page.screenshot({path:join(LOG_DIR,'03_after.png')});
        didClick=true;
        
        // 观察
        log('观察30秒...');
        for(let w=0;w<15;w++){
          await sleep(2000);
          const t=await page.evaluate(()=>{try{return turnstile.getResponse();}catch(e){return null;}});
          const u=page.url();
          const h=(()=>{try{return new URL(u).hostname}catch(e){return''}})();
          log(`  ${w*2}s: token=${t?'YES:'+t.substring(0,20):'NO'} url=${u.substring(0,50)}`);
          if(t&&t.length>20){log('✅ Token!');solved=true;break;}
          if(h.endsWith('.zo.computer')&&h!=='www.zo.computer'){log('🎉 跳转！');solved=true;break;}
        }
        if(solved)break;
      }
      if(attempt%5===0){log('再次点击...');await naturalClick(page,box);}
    } else {
      log('⚠ Widget不可见');
    }
    await sleep(3000);
  }

  if(!solved)log('\n❌ 未破解');
  else log('\n🎉 成功！');
  log(`最终: ${page.url()}`);
  await page.screenshot({path:join(LOG_DIR,'FINAL.png')});
  log('保持30s...');
  await sleep(30000);
  await context.close();
  log('完成');
}

main().catch(e=>{log(`错误: ${e.message}\n${e.stack}`);process.exit(1);});
