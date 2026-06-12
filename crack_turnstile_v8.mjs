/**
 * Turnstile 破解 v8.0 — 观察+触发模式
 * 
 * 关键发现：widget 300x65 @(565,324)，点击可行但没立即反应
 * 可能是 managed 隐身验证型，需观察 token 生成 + 适时点击触发
 */
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOG_DIR = join(__dirname, 'logs', 'crack_v8');
const EMAIL_FILE = 'C:\\Users\\XZXyuan\\Downloads\\批量注册邮箱\\已经使用\\sanchezquinncu3w1kkhtuc74@outlook.com.txt';
if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));
const now = () => new Date().toISOString();
const log = msg => { const m = `[${now()}] ${msg}`; console.log(m); appendFileSync(join(LOG_DIR, 'log.txt'), m + '\n'); };
const rand = (a,b) => a + Math.random() * (b-a);

const emailContent = readFileSync(EMAIL_FILE, 'utf-8').trim();
const [EMAIL, PASSWORD, CLIENT_ID, REFRESH_TOKEN] = emailContent.split('----').map(s=>s.trim());

async function getMagicLink() {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: false, args:['--window-size=1440,900'] });
  const ctx = await browser.newContext({ viewport:{width:1440,height:900}, userAgent:'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/137.0.0.0 Safari/537.36', locale:'zh-CN' });
  const p = await ctx.newPage();
  try { await p.goto('https://www.zo.computer/signup', {waitUntil:'networkidle',timeout:30000}); } catch(e){}
  await sleep(3000);

  await p.evaluate(()=>{ for(const btn of document.querySelectorAll('button,a')){ if(/email/i.test(btn.textContent||'') && btn.offsetParent){ btn.click(); return; } } });
  await sleep(2000);
  await p.evaluate(email=>{ const inp=document.querySelector('input[type=email]')||document.querySelector('input'); if(inp){ const s=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set; s.call(inp,email); inp.dispatchEvent(new Event('input',{bubbles:true})); } }, EMAIL);
  await sleep(500);
  await p.evaluate(()=>{ for(const btn of document.querySelectorAll('button')){ if(/continue/i.test(btn.textContent||'')){ btn.click(); return; } } });
  await sleep(3000);

  const sendTime=new Date(Date.now()-3000);
  let link=null, rt=REFRESH_TOKEN;
  for(let i=0;i<30;i++){
    try {
      const body=new URLSearchParams({client_id:CLIENT_ID,grant_type:'refresh_token',refresh_token:rt,scope:'https://graph.microsoft.com/.default offline_access'});
      const tr=await fetch('https://login.microsoftonline.com/consumers/oauth2/v2.0/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:body.toString()});
      const td=await tr.json();
      if(td.error){await sleep(3000);continue;}
      rt=td.refresh_token||rt;
      const mr=await fetch('https://graph.microsoft.com/v1.0/me/messages?$top=10&$select=subject,body,receivedDateTime&$orderby=receivedDateTime%20desc',{headers:{Authorization:'Bearer '+td.access_token}});
      const md=await mr.json();
      for(const msg of (md.value||[])){
        if(new Date(msg.receivedDateTime)<sendTime)continue;
        const c=(msg.subject||'')+' '+(msg.body?.content||'');
        if(!/zo/i.test(c))continue;
        const links=c.match(/https?:\/\/[^\s"'<>]*zo\.computer[^\s"'<>]*/gi)||[];
        for(let l of links){l=l.replace(/[)\]>,;!?\s]+$/,'').replace(/&amp;/g,'&');if(/token=|verify|login/i.test(l)){link=l;break;}}
        if(link)break;
      }
    }catch(e){}
    if(link)break;
    process.stdout.write('.');
    await sleep(3000);
  }
  await p.close();await ctx.close();await browser.close();
  if(!link)throw new Error('No link');
  if(rt!==REFRESH_TOKEN)writeFileSync(EMAIL_FILE,[EMAIL,PASSWORD,CLIENT_ID,rt].join('----'),'utf-8');
  return link;
}

// ========== CDP 找 Turnstile widget 位置 ==========
async function getTurnstileBox(cdp) {
  const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
  let bestBox=null;

  function dfs(node, depth) {
    if(depth>80||!node)return;
    const tag=(node.localName||'').toLowerCase();

    if(tag==='iframe'&&node.attributes){
      const attrs=Array.isArray(node.attributes)?node.attributes:[];
      const si=attrs.findIndex(a=>a==='src');
      const src=si>=0?(attrs[si+1]||''):'';
      if(src.includes('challenges.cloudflare')||src.includes('turnstile')){
        try{bestBox={nodeId:node.nodeId,src};}catch(e){}
        return;
      }
    }
    if(node.shadowRoots)for(const sr of node.shadowRoots)dfs(sr,depth+1);
    if(node.children)for(const c of node.children)dfs(c,depth+1);
    if(node.contentDocument)dfs(node.contentDocument,depth+1);
  }
  dfs(root,0);

  if(!bestBox)return null;

  try{
    const boxModel=await cdp.send('DOM.getBoxModel',{nodeId:bestBox.nodeId});
    if(boxModel?.model?.content){
      const c=boxModel.model.content;
      bestBox.box={x:c[0],y:c[1],w:c[2]-c[0],h:c[5]-c[1]};
    }
  }catch(e){}

  return bestBox;
}

// ========== 连续多次点击（多角度尝试） ==========
async function multiClick(page, box) {
  if(!box?.box)return;

  const { x, y, w, h } = box.box;

  // 点击位置序列：checkbox中心、偏左、偏右、上半、下半
  const spots = [
    { dx: 28, dy: h/2, desc: 'checkbox中心' },
    { dx: 26, dy: h*0.48, desc: '偏左上' },
    { dx: 30, dy: h*0.52, desc: '偏右下' },
    { dx: 28, dy: h*0.45, desc: '偏上' },
    { dx: 28, dy: h*0.55, desc: '偏下' },
  ];

  for(const spot of spots) {
    const clickX = x + spot.dx;
    const clickY = y + spot.dy;

    // 真人移动
    const startX = clickX + rand(60,150)*(Math.random()>.5?1:-1);
    const startY = clickY + rand(30,80)*(Math.random()>.5?1:-1);
    const steps = Math.floor(rand(5,8));
    for(let s=1;s<=steps;s++){
      const p=s/steps;
      await page.mouse.move(
        startX+(clickX-startX)*p+Math.sin(p*Math.PI*1.5)*rand(-6,6),
        startY+(clickY-startY)*p+Math.cos(p*Math.PI)*rand(-4,4)
      );
      await sleep(rand(15,40));
    }
    await sleep(rand(40,120));
    await page.mouse.move(clickX, clickY);
    await sleep(rand(30,80));
    await page.mouse.down();
    await sleep(rand(25,60));
    await page.mouse.up();

    log(`   已点 ${spot.desc} (${Math.round(clickX)},${Math.round(clickY)})`);

    // 每次点击后检查
    const token = await page.evaluate(()=>{
      try{return turnstile.getResponse();}catch(e){return null;}
    });
    if(token && token.length>20){
      log(`   ✅ Token生成！`);
      return true;
    }
    await sleep(rand(500,1200));
  }
  return false;
}

// ========== 主流程 ==========
async function main() {
  log('='.repeat(60));
  log('Turnstile 破解 v8.0 — 观察+触发');
  log('='.repeat(60));

  log('\n获取 magic link...');
  const magicLink = await getMagicLink();
  log(`✅ link`);

  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: false, args:['--window-size=1440,900'] });
  const context = await browser.newContext({
    viewport:{width:1440,height:900},
    userAgent:'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/137.0.0.0 Safari/537.36',
    locale:'zh-CN',
  });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('DOM.enable');

  // ===== 循环 =====
  let solved=false, attempt=0;
  let didClick=false;

  while(!solved && attempt<50) {
    attempt++;
    log(`\n=== 尝试 ${attempt} ===`);

    const url=page.url();
    const hostname=(()=>{try{return new URL(url).hostname}catch(e){return ''}})();
    if(hostname.endsWith('.zo.computer')&&hostname!=='www.zo.computer'){log('🎉 子域名！');solved=true;break;}

    // 如果不是verify页面，导航
    if(!url.includes('/verify') && attempt===1){
      log('导航到 magic link...');
      try{await page.goto(magicLink,{waitUntil:'domcontentloaded',timeout:60000});}catch(e){}
      await sleep(12000);
      await page.screenshot({path:join(LOG_DIR,'01_navigated.png')});
    }

    // 检查token
    const token = await page.evaluate(()=>{
      try{
        const r = turnstile.getResponse();
        return r && r.length>10 ? r : null;
      }catch(e){return null;}
    });
    if(token){
      log(`✅ Token: ${token.substring(0,40)}...`);
      // 把token填入hidden input
      await page.evaluate(t=>{
        const inp = document.querySelector('[name="cf-turnstile-response"]');
        if(inp){const s=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;s.call(inp,t);inp.dispatchEvent(new Event('change',{bubbles:true}));}
      }, token);
      // 等待跳转
      for(let w=0;w<15;w++){
        await sleep(2000);
        const h=(()=>{try{return new URL(page.url()).hostname}catch(e){return''}})();
        if(h.endsWith('.zo.computer')&&h!=='www.zo.computer'){solved=true;break;}
      }
      if(solved)break;
    }

    // 检查页面文本
    const text = await page.evaluate(()=>document.body?.innerText?.substring(0,300)||'');
    log(`页面: ${text.substring(0,150)}`);

    if(/choose your handle|set up your profile|welcome|dashboard/i.test(text)){
      log('🎉 注册流程！');solved=true;break;
    }

    if(/invalid|expired/i.test(text)&&!/redirecting/i.test(text)){
      log('⚠ Expired, 重新导航...');
      try{await page.goto(magicLink,{waitUntil:'domcontentloaded',timeout:30000});}catch(e){}
      await sleep(12000);
      didClick=false;
      continue;
    }

    // 找Turnstile widget
    const box = await getTurnstileBox(cdp);
    if(box?.box){
      log(`Widget: (${Math.round(box.box.x)},${Math.round(box.box.y)}) ${Math.round(box.box.w)}x${Math.round(box.box.h)}`);

      // 第1次：模拟浏览后点击多个位置
      if(!didClick){
        log('模拟浏览行为...');
        for(let i=0;i<4;i++){await page.mouse.move(rand(200,900),rand(100,700),{steps:Math.floor(rand(4,8))});await sleep(rand(200,500));}
        await page.mouse.wheel(0,rand(50,150));await sleep(rand(400,800));

        log('开始点击 Turnstile...');
        await page.screenshot({path:join(LOG_DIR,'02_before_click.png')});
        await multiClick(page, box);
        await page.screenshot({path:join(LOG_DIR,'03_after_click.png')});

        didClick=true;
        log('点击完成，等待30秒观察...');

        // 观察30秒
        for(let w=0;w<15;w++){
          await sleep(2000);
          const t = await page.evaluate(()=>{try{return turnstile.getResponse();}catch(e){return null;}});
          const u=page.url();
          const h=(()=>{try{return new URL(u).hostname}catch(e){return''}})();
          log(`  ${w*2}s: token=${t?'YES:'+t.substring(0,20):'NO'} url=${u.substring(0,60)}`);
          if(t&&t.length>20){log('✅ Token出现！');solved=true;break;}
          if(h.endsWith('.zo.computer')&&h!=='www.zo.computer'){log('🎉 跳转！');solved=true;break;}
        }
        if(solved)break;
      }

      // 第2+次：已经点过，周期性再尝试
      if(attempt%5===0){
        log('再次尝试点击...');
        await multiClick(page, box);
      }
    } else {
      log('⚠ No visible widget');
    }

    await sleep(3000);
  }

  if(!solved)log('\n❌ 未破解');
  else log('\n🎉 成功！');

  log(`最终: ${page.url()}`);
  await page.screenshot({path:join(LOG_DIR,'FINAL.png')});
  log('保持30s...');
  await sleep(30000);
  await browser.close();
  log('完成');
}

main().catch(e=>{log(`错误: ${e.message}\n${e.stack}`);process.exit(1);});
