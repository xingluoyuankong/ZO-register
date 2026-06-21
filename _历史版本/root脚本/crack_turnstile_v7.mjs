/**
 * Turnstile 破解 v7.0 — CDP找Shadow主机 + Box Model + 真人点击
 * 
 * 策略：CDP穿透Shadow DOM找到iframe → 回溯找Shadow宿主div → 获取宿主坐标 → 点击
 */
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOG_DIR = join(__dirname, 'logs', 'crack_v7');
const EMAIL_FILE = 'C:\\Users\\XZXyuan\\Downloads\\批量注册邮箱\\已经使用\\sanchezquinncu3w1kkhtuc74@outlook.com.txt';
if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));
const now = () => new Date().toISOString();
const log = msg => { const m = `[${now()}] ${msg}`; console.log(m); appendFileSync(join(LOG_DIR, 'log.txt'), m + '\n'); };
const rand = (a, b) => a + Math.random() * (b - a);

const emailContent = readFileSync(EMAIL_FILE, 'utf-8').trim();
const [EMAIL, PASSWORD, CLIENT_ID, REFRESH_TOKEN] = emailContent.split('----').map(s => s.trim());

// ========== 获取 magic link ==========
async function getMagicLink() {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: false, args: ['--window-size=1440,900'] });
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/137.0.0.0 Safari/537.36',
    locale: 'zh-CN',
  });
  const p = await ctx.newPage();
  try { await p.goto('https://www.zo.computer/signup', { waitUntil: 'networkidle', timeout: 30000 }); } catch (e) {}
  await sleep(3000);

  await p.evaluate(() => {
    for (const btn of document.querySelectorAll('button, a')) {
      if (/email/i.test(btn.textContent||'') && btn.offsetParent) { btn.click(); return; }
    }
  });
  await sleep(2000);

  await p.evaluate(email => {
    const inp = document.querySelector('input[type=email]') || document.querySelector('input');
    if (inp) { const s=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set; s.call(inp,email); inp.dispatchEvent(new Event('input',{bubbles:true})); }
  }, EMAIL);
  await sleep(500);

  await p.evaluate(() => {
    for (const btn of document.querySelectorAll('button')) {
      if (/continue/i.test(btn.textContent||'')) { btn.click(); return; }
    }
  });
  await sleep(3000);

  const sendTime = new Date(Date.now() - 3000);
  let link = null, rt = REFRESH_TOKEN;
  for (let i=0;i<30;i++) {
    try {
      const body = new URLSearchParams({ client_id: CLIENT_ID, grant_type:'refresh_token', refresh_token:rt, scope:'https://graph.microsoft.com/.default offline_access' });
      const tr = await fetch('https://login.microsoftonline.com/consumers/oauth2/v2.0/token', { method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'}, body:body.toString() });
      const td = await tr.json();
      if (td.error) { await sleep(3000); continue; }
      rt = td.refresh_token || rt;
      const mr = await fetch('https://graph.microsoft.com/v1.0/me/messages?$top=10&$select=subject,body,receivedDateTime&$orderby=receivedDateTime%20desc', { headers:{Authorization:'Bearer '+td.access_token} });
      const md = await mr.json();
      for (const msg of (md.value||[])) {
        if (new Date(msg.receivedDateTime) < sendTime) continue;
        const c = (msg.subject||'')+' '+(msg.body?.content||'');
        if (!/zo/i.test(c)) continue;
        const links = c.match(/https?:\/\/[^\s"'<>]*zo\.computer[^\s"'<>]*/gi) || [];
        for (let l of links) { l = l.replace(/[)\]>,;!?\s]+$/,'').replace(/&amp;/g,'&'); if (/token=|verify|login/i.test(l)) { link = l; break; } }
        if (link) break;
      }
    } catch(e) {}
    if (link) break;
    process.stdout.write('.');
    await sleep(3000);
  }
  await p.close(); await ctx.close(); await browser.close();
  if (!link) throw new Error('No link');
  if (rt !== REFRESH_TOKEN) writeFileSync(EMAIL_FILE, [EMAIL,PASSWORD,CLIENT_ID,rt].join('----'),'utf-8');
  return link;
}

// ========== CDP递归找Turnstile iframe及其Shadow宿主 ==========
async function findTurnstileWidgetBox(cdp) {
  const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });

  // 递归dfs，跟踪shadowRoot宿主
  let found = null;

  function dfs(node, path, shadowHostNodeId, depth) {
    if (found || depth > 80 || !node) return;
    const tag = (node.localName || node.nodeName || '').toLowerCase();
    const cp = path ? `${path}/${tag || '#' + node.nodeType}` : 'root';

    if (tag === 'iframe' && node.attributes) {
      const attrs = Array.isArray(node.attributes) ? node.attributes : [];
      const srcIdx = attrs.findIndex(a => a === 'src');
      const src = srcIdx >= 0 ? (attrs[srcIdx + 1] || '') : '';
      if (src.includes('challenges.cloudflare') || src.includes('turnstile')) {
        found = { iframeNodeId: node.nodeId, shadowHostNodeId, src, path: cp };
        return;
      }
    }

    // 在shadowRoot内部搜索时，记录哪个node是这个shadowRoot的host
    if (node.shadowRoots) {
      for (const sr of node.shadowRoots) {
        dfs(sr, cp + '::shadow', node.nodeId, depth + 1);
      }
    }

    if (node.children) {
      for (const c of node.children) {
        dfs(c, cp, null, depth + 1);
      }
    }

    if (node.contentDocument) {
      dfs(node.contentDocument, cp + '::content', null, depth + 1);
    }
  }

  dfs(root, '', null, 0);
  return found;
}

// ========== 获取Shadow Host的box model ==========
async function getShadowHostBox(cdp, shadowHostNodeId) {
  try {
    const boxModel = await cdp.send('DOM.getBoxModel', { nodeId: shadowHostNodeId });
    if (boxModel?.model?.content) {
      const c = boxModel.model.content; // [x1,y1,x2,y2,x3,y3,x4,y4]
      return { x: c[0], y: c[1], w: c[2] - c[0], h: c[5] - c[1] };
    }
  } catch (e) {}
  return null;
}

// ========== 真人点击 ==========
async function humanClick(page, targetX, targetY) {
  log(`  点击坐标 (${Math.round(targetX)}, ${Math.round(targetY)})`);

  const startX = targetX + rand(80, 200) * (Math.random()>.5?1:-1);
  const startY = targetY + rand(40, 120) * (Math.random()>.5?1:-1);

  const steps = Math.floor(rand(6, 10));
  for (let s = 1; s <= steps; s++) {
    const p = s / steps;
    const mx = startX + (targetX - startX) * p + Math.sin(p*Math.PI*1.5) * rand(-8, 8);
    const my = startY + (targetY - startY) * p + Math.cos(p*Math.PI) * rand(-6, 6);
    await page.mouse.move(mx, my);
    await sleep(rand(20, 50));
  }

  await sleep(rand(100, 300));
  await page.mouse.move(targetX + rand(-3, 3), targetY + rand(-2, 2));
  await sleep(rand(50, 120));
  await page.mouse.move(targetX, targetY);
  await sleep(rand(60, 150));

  await page.mouse.down();
  await sleep(rand(35, 75));
  await page.mouse.up();

  log(`  ✅ 已点击`);
}

// ========== 主流程 ==========
async function main() {
  log('='.repeat(60));
  log('Turnstile 破解 v7.0 — CDP Shadow Host + 真人点击');
  log('='.repeat(60));

  log('\n获取 magic link...');
  const magicLink = await getMagicLink();
  log(`✅ ${magicLink.substring(0, 80)}...`);

  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: false, args: ['--window-size=1440,900'] });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/137.0.0.0 Safari/537.36',
    locale: 'zh-CN',
  });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('DOM.enable');

  log('打开 magic link...');
  try { await page.goto(magicLink, { waitUntil: 'domcontentloaded', timeout: 60000 }); } catch(e){}
  log('等待 Turnstile 加载（12秒）...');
  await sleep(12000);
  await page.screenshot({ path: join(LOG_DIR, '01_loaded.png') });

  // ===== 主循环 =====
  let solved = false, attempt = 0;

  while (!solved && attempt < 40) {
    attempt++;
    log(`\n=== 尝试 ${attempt} ===`);

    const url = page.url();
    const hostname = (() => { try { return new URL(url).hostname; } catch(e){ return ''; } })();
    if (hostname.endsWith('.zo.computer') && hostname !== 'www.zo.computer') {
      log('🎉 子域名！'); solved = true; break;
    }

    // ★ CDP找到 Turnstile iframe 和 Shadow host
    const found = await findTurnstileWidgetBox(cdp);
    
    if (found) {
      log(`  找到 iframe: path=${found.path.substring(0,100)}`);
      log(`  shadowHostNodeId: ${found.shadowHostNodeId}`);

      let box = null;

      if (found.shadowHostNodeId) {
        box = await getShadowHostBox(cdp, found.shadowHostNodeId);
      }

      // Fallback: 如果shadow host拿不到，尝试iframe本身的box
      if (!box || box.w <= 0) {
        try {
          const iframeBox = await cdp.send('DOM.getBoxModel', { nodeId: found.iframeNodeId });
          if (iframeBox?.model?.content) {
            const c = iframeBox.model.content;
            box = { x: c[0], y: c[1], w: c[2]-c[0], h: c[5]-c[1] };
          }
        } catch(e){}
      }

      if (!box || box.w <= 0 || box.h <= 0) {
        log('  ⚠ 无法获取 widget 坐标');
        await sleep(2000);
        continue;
      }

      log(`  widget box: (${Math.round(box.x)},${Math.round(box.y)}) ${Math.round(box.w)}x${Math.round(box.h)}`);

      // ★ checkbox: widget左侧28px, 垂直居中
      const checkboxX = box.x + 28;
      const checkboxY = box.y + box.h / 2;

      // 截图
      await page.screenshot({ path: join(LOG_DIR, `${String(attempt).padStart(2,'0')}_before.png`) });

      // 真人行为
      log('模拟浏览...');
      for (let i=0;i<4;i++) { await page.mouse.move(rand(200,900), rand(100,700), {steps:Math.floor(rand(4,8))}); await sleep(rand(200,500)); }
      await page.mouse.wheel(0, rand(50,150)); await sleep(rand(400,800));
      await page.mouse.wheel(0, rand(-30,-60)); await sleep(rand(300,600));

      // ★ 点击
      await humanClick(page, checkboxX, checkboxY);

      // 等待验证
      log('等待验证...');
      for (let w=0;w<30;w++) {
        await sleep(2000);
        const curUrl = page.url();
        const chost = (()=>{try{return new URL(curUrl).hostname}catch(e){return ''}})();
        if (chost.endsWith('.zo.computer') && chost !== 'www.zo.computer') { log('🎉 子域名！'); solved=true; break; }

        const text = await page.evaluate(()=>document.body?.innerText?.substring(0,300)||'');
        if (/choose your handle|set up your profile|welcome|dashboard/i.test(text)) { log('🎉 注册流程！'); solved=true; break; }

        const hasToken = await page.evaluate(()=>{
          const inp = document.querySelector('[name="cf-turnstile-response"]');
          return !!(inp && inp.value && inp.value.length>20);
        });
        if (hasToken) { log('✅ Token!'); solved=true; break; }

        if (/invalid|expired/i.test(text) && !/redirecting/i.test(text)) {
          log('⚠ Expired, 刷新...');
          try { await page.reload({ waitUntil:'domcontentloaded', timeout:30000 }); } catch(e){}
          await sleep(12000);
          break;
        }
        if (w%5===0) log(`  ${w*2}s...`);
      }

      await page.screenshot({ path: join(LOG_DIR, `${String(attempt).padStart(2,'0')}_after.png`) });
      if (solved) break;
    } else {
      log('⚠ 未找到 Turnstile');
      const text = await page.evaluate(()=>document.body?.innerText?.substring(0,300)||'');
      if (/choose your handle|set up your profile|welcome|dashboard/i.test(text)) { solved=true; break; }
      if (/invalid|expired/i.test(text)) {
        try { await page.reload({ waitUntil:'domcontentloaded', timeout:30000 }); } catch(e){}
        await sleep(12000);
        continue;
      }
      await sleep(3000);
    }
  }

  if (!solved) log('\n❌ 未破解');
  else log('\n🎉 成功！');

  log(`最终 URL: ${page.url().substring(0,100)}`);
  await page.screenshot({ path: join(LOG_DIR, 'FINAL.png') });
  log('保持 60s...');
  await sleep(60000);
  await browser.close();
  log('完成');
}

main().catch(e=>{ log(`错误: ${e.message}\n${e.stack}`); process.exit(1); });
