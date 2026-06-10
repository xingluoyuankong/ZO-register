// ZO Register - 通过 puppeteer frame API 直接操作 Turnstile
const puppeteer = require('E:\\API获取工具\\ZO注册\\node_modules\\puppeteer-core');
const { readFileSync } = require('fs');
const { join } = require('path');

const CONFIG = {
  EMAIL_DIR: "C:\\Users\\XZXyuan\\Downloads\\批量注册邮箱\\已经使用",
  GRAPH_TOKEN_URL: "https://login.microsoftonline.com/consumers/oauth2/v2.0/token",
  GRAPH_MAIL_URL: "https://graph.microsoft.com/v1.0/me/messages",
  DEBUG_DIR: "E:\\API获取工具\\ZO注册\\registered",
};

const MAIN_PATCH = `(function(){
  if(window.__CF_BYPASS__)return;window.__CF_BYPASS__=true;
  var X=960,Y=540;
  Object.defineProperty(MouseEvent.prototype,'screenX',{get:function(){return(this.clientX||0)+X}});
  Object.defineProperty(MouseEvent.prototype,'screenY',{get:function(){return(this.clientY||0)+Y}});
  Object.defineProperty(PointerEvent.prototype,'screenX',{get:function(){return(this.clientX||0)+X}});
  Object.defineProperty(PointerEvent.prototype,'screenY',{get:function(){return(this.clientY||0)+Y}});
  Object.defineProperty(navigator,'webdriver',{get:()=>undefined});
})();`;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const browser = await puppeteer.connect({ browserURL: 'http://localhost:9222', defaultViewport: null, timeout: 10000 });

  // Get email and send new link
  const emailFile = join(CONFIG.EMAIL_DIR, 'sanchezquinncu3w1kkhtuc74@outlook.com__Pxcuyi6K50yVZPnD.txt');
  const content = readFileSync(emailFile, 'utf-8').trim();
  const [email, password, clientId, refreshToken] = content.split('----').map(s => s.trim());

  const body = new URLSearchParams({
    client_id: clientId, grant_type: 'refresh_token', refresh_token: refreshToken,
    scope: 'https://graph.microsoft.com/.default offline_access',
  });
  const tokenResp = await fetch(CONFIG.GRAPH_TOKEN_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString(),
  });
  const tokenData = await tokenResp.json();
  const accessToken = tokenData.access_token;

  console.log('Sending magic link...');
  await fetch('https://www.zo.computer/api/email-login/request', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }),
  });
  await sleep(8000);

  let link = '';
  for (let i = 0; i < 20; i++) {
    const mailResp = await fetch(CONFIG.GRAPH_MAIL_URL + '?$top=3&$select=subject,body,receivedDateTime&$orderby=receivedDateTime%20desc', {
      headers: { Authorization: 'Bearer ' + accessToken }
    });
    const mail = await mailResp.json();
    for (const msg of (mail.value || [])) {
      const combined = (msg.subject || '') + ' ' + ((msg.body && msg.body.content) || '');
      const links = combined.match(/https:\/\/www\.zo\.computer\/api\/email-login\/verify[^\s"'<>]*/gi) || [];
      let l = links[0] || '';
      l = l.replace(/[)\]>,;!?\s]+$/, '').replace(/&amp;/g, '&');
      if (l && l.includes('token=')) { link = l; break; }
    }
    if (link) break;
    console.log(`  Poll ${i+1}/20...`);
    await sleep(5000);
  }
  if (!link) { console.log('No link!'); process.exit(1); }
  console.log('Got link');

  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.evaluateOnNewDocument(MAIN_PATCH);

  console.log('\n--- Opening link ---');
  await page.goto(link, { waitUntil: 'networkidle0', timeout: 60000 }).catch(() => {});
  await sleep(8000);

  await page.screenshot({ path: join(CONFIG.DEBUG_DIR, 'debug_frame_1.png'), fullPage: true });

  // Find frames
  const frames = page.frames();
  console.log('\nAll frames:', frames.length);
  const tsFrame = frames.find(f => f.url().includes('challenges.cloudflare.com'));

  if (!tsFrame) {
    console.log('No Turnstile frame!');
    await context.close(); browser.disconnect();
    return;
  }

  console.log('Turnstile frame URL:', tsFrame.url().substring(0, 150));

  // === Method 1: Try to get frame element position via page evaluation ===
  console.log('\n=== Method 1: Finding iframe element ===');
  const iframeSearch = await page.evaluate(() => {
    // Check all elements, not just iframes
    const all = document.querySelectorAll('*');
    const results = [];
    for (const el of all) {
      // Check if element has an iframe child
      if (el.shadowRoot) {
        const iframes = el.shadowRoot.querySelectorAll('iframe');
        if (iframes.length > 0) {
          results.push({
            tag: el.tagName,
            id: el.id,
            class: el.className,
            shadowIframeCount: iframes.length,
            iframeSrcs: Array.from(iframes).map(f => f.src),
          });
        }
      }
      // Check if element itself is an iframe
      if (el.tagName === 'IFRAME') {
        const rect = el.getBoundingClientRect();
        results.push({
          tag: 'IFRAME',
          src: el.src,
          x: rect.x,
          y: rect.y,
          w: rect.width,
          h: rect.height,
        });
      }
    }
    return results;
  });
  console.log('Iframe search results:', JSON.stringify(iframeSearch, null, 2));

  // === Method 2: Use puppeteer's frame.click() ===
  console.log('\n=== Method 2: frame.click() ===');
  try {
    // Try clicking on the body of the Turnstile frame
    await tsFrame.click('body').catch(e => console.log('frame.click(body) failed:', e.message));
    console.log('Clicked body in frame');
    await sleep(3000);

    const token1 = await page.evaluate(() => {
      const input = document.querySelector('input[name="cf-turnstile-response"]');
      return input ? input.value : 'no input';
    });
    console.log('Token after frame.click:', token1 ? token1.substring(0, 50) + '...' : 'empty');
  } catch(e) {
    console.log('Method 2 error:', e.message);
  }

  // === Method 3: Try to find and click elements inside the frame ===
  console.log('\n=== Method 3: Exploring frame content ===');
  try {
    const frameContent = await tsFrame.evaluate(() => {
      return {
        url: window.location.href,
        title: document.title,
        readyState: document.readyState,
        bodyText: document.body ? document.body.innerText : 'no body',
        bodyHTML: document.body ? document.body.innerHTML.substring(0, 2000) : 'no body',
        allElements: document.querySelectorAll('*').length,
        scripts: Array.from(document.querySelectorAll('script')).map(s => s.src || s.textContent.substring(0, 100)),
        styles: Array.from(document.querySelectorAll('style')).length,
        links: Array.from(document.querySelectorAll('link')).map(l => l.href),
      };
    });
    console.log('Frame content:', JSON.stringify(frameContent, null, 2));
  } catch(e) {
    console.log('Cannot access frame content:', e.message);
  }

  // === Method 4: Try to click at specific coordinates in the frame ===
  console.log('\n=== Method 4: Coordinate-based clicking ===');
  
  // The Turnstile widget is typically 300x65 pixels
  // Try clicking at the center of where it should be
  // Based on the screenshot, it appears around x=200-400, y=280-350
  
  // First, let's find where the "Verifying your browser" text is
  const textPos = await page.evaluate(() => {
    // Look for any text containing "Verifying" or "Turnstile"
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const results = [];
    while (walker.nextNode()) {
      const text = walker.currentNode.textContent;
      if (text.includes('Verifying') || text.includes('browser') || text.includes('Turnstile')) {
        const range = document.createRange();
        range.selectNode(walker.currentNode);
        const rect = range.getBoundingClientRect();
        results.push({
          text: text.substring(0, 50),
          x: rect.x,
          y: rect.y,
          w: rect.width,
          h: rect.height,
        });
      }
    }
    return results;
  });
  console.log('Text positions:', JSON.stringify(textPos, null, 2));

  // Try clicking in various positions around where the widget should be
  const cdp = await page.createCDPSession();
  
  // Based on typical Turnstile widget layout, it should be below the "Verifying" text
  const clickTargets = [
    { x: 300, y: 320, desc: 'typical widget position' },
    { x: 350, y: 320, desc: 'typical widget position 2' },
    { x: 400, y: 320, desc: 'typical widget position 3' },
    { x: 300, y: 300, desc: 'higher position' },
    { x: 350, y: 300, desc: 'higher position 2' },
    { x: 400, y: 300, desc: 'higher position 3' },
    { x: 300, y: 340, desc: 'lower position' },
    { x: 350, y: 340, desc: 'lower position 2' },
    { x: 400, y: 340, desc: 'lower position 3' },
    { x: 250, y: 320, desc: 'left position' },
    { x: 450, y: 320, desc: 'right position' },
  ];

  for (const target of clickTargets) {
    console.log(`\nClicking at (${target.x}, ${target.y}) - ${target.desc}`);
    
    // Move mouse first (human-like)
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved', x: target.x, y: target.y,
    });
    await sleep(200);
    
    // Click
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mousePressed', x: target.x, y: target.y, button: 'left', clickCount: 1,
    });
    await sleep(100);
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased', x: target.x, y: target.y, button: 'left', clickCount: 1,
    });
    await sleep(3000);

    // Check token
    const token = await page.evaluate(() => {
      const input = document.querySelector('input[name="cf-turnstile-response"]');
      return input ? input.value : 'no input';
    });
    
    if (token && token.length > 10) {
      console.log('*** TOKEN FOUND! ***', token.substring(0, 50) + '...');
      break;
    }
    console.log('Token still empty');
  }

  // === Method 5: Try turnstile API methods ===
  console.log('\n=== Method 5: Turnstile API ===');
  
  // Reset and wait
  await page.evaluate(() => {
    try { turnstile.reset(); } catch(e) {}
  });
  await sleep(5000);

  // Try various turnstile methods
  const tsMethods = await page.evaluate(() => {
    const results = {};
    try { results.getResponse = turnstile.getResponse(); } catch(e) { results.getResponse = e.message; }
    try { results.isExpired = turnstile.isExpired(); } catch(e) { results.isExpired = e.message; }
    try { results.execute = typeof turnstile.execute; } catch(e) { results.execute = e.message; }
    return results;
  });
  console.log('Turnstile methods:', JSON.stringify(tsMethods, null, 2));

  // Final screenshot
  await page.screenshot({ path: join(CONFIG.DEBUG_DIR, 'debug_frame_2.png'), fullPage: true });

  // Final state
  const finalToken = await page.evaluate(() => {
    const input = document.querySelector('input[name="cf-turnstile-response"]');
    return input ? input.value : 'no input';
  });
  console.log('\n=== Final State ===');
  console.log('Token:', finalToken ? finalToken.substring(0, 50) + '...' : 'empty');
  console.log('URL:', page.url());

  await context.close();
  browser.disconnect();
  console.log('\nDone!');
})().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
