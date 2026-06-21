// ZO Register - 精确点击 Turnstile widget
// 基于截图分析: Turnstile widget 在页面上的位置
const puppeteer = require('E:\\API获取工具\\ZO注册\\node_modules\\puppeteer-core');
const { readFileSync } = require('fs');
const { join } = require('path');

const CONFIG = {
  EMAIL_DIR: "C:\\Users\\XZXyuan\\Downloads\\批量注册邮箱\\已经使用",
  GRAPH_TOKEN_URL: "https://login.microsoftonline.com/consumers/oauth2/v2.0/token",
  GRAPH_MAIL_URL: "https://graph.microsoft.com/v1.0/me/messages",
  DEBUG_DIR: "E:\\API获取工具\\ZO注册\\registered",
};

// 更强的补丁 - 不仅覆盖 screenX/Y，还覆盖其他检测点
const MAIN_PATCH = `(function(){
  if(window.__CF_BYPASS__)return;window.__CF_BYPASS__=true;
  
  // screenX/Y - 固定值（像真实用户一样）
  var X=960,Y=540;
  Object.defineProperty(MouseEvent.prototype,'screenX',{get:function(){return(this.clientX||0)+X}});
  Object.defineProperty(MouseEvent.prototype,'screenY',{get:function(){return(this.clientY||0)+Y}});
  Object.defineProperty(PointerEvent.prototype,'screenX',{get:function(){return(this.clientX||0)+X}});
  Object.defineProperty(PointerEvent.prototype,'screenY',{get:function(){return(this.clientY||0)+Y}});
  
  // navigator.webdriver
  Object.defineProperty(navigator,'webdriver',{get:()=>undefined});
  
  // plugins
  Object.defineProperty(navigator,'plugins',{get:()=>[1,2,3,4,5]});
  
  // languages
  Object.defineProperty(navigator,'languages',{get:()=>['zh-CN','zh','en']});
  
  // platform
  Object.defineProperty(navigator,'platform',{get:()=>'Win32'});
  
  // chrome.runtime
  if(!window.chrome)window.chrome={};
  if(!window.chrome.runtime)window.chrome.runtime={connect:function(){},sendMessage:function(){}};
  
  // Permission API
  const originalQuery = window.navigator.permissions?.query;
  if (originalQuery) {
    window.navigator.permissions.query = (parameters) => (
      parameters.name === 'notifications' ?
        Promise.resolve({ state: Notification.permission }) :
        originalQuery(parameters)
    );
  }
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

  // Get link
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

  // Screenshot
  await page.screenshot({ path: join(CONFIG.DEBUG_DIR, 'debug_click_1_initial.png'), fullPage: true });
  console.log('Screenshot saved');

  // Find all frames
  const frames = page.frames();
  console.log('\nFrames:', frames.length);
  for (const f of frames) {
    console.log('  -', f.url().substring(0, 100));
  }

  // Find the Turnstile frame
  const tsFrame = frames.find(f => f.url().includes('challenges.cloudflare.com'));
  
  if (tsFrame) {
    console.log('\n=== Turnstile Frame Found ===');
    console.log('URL:', tsFrame.url().substring(0, 150));

    // Get frame dimensions using CDP
    const cdp = await page.createCDPSession();
    
    // Find the iframe element position on the page
    const iframeInfo = await page.evaluate(() => {
      // Method 1: Direct iframe query
      const iframes = document.querySelectorAll('iframe');
      for (const iframe of iframes) {
        if (iframe.src && iframe.src.includes('challenges.cloudflare.com')) {
          const rect = iframe.getBoundingClientRect();
          return { found: true, x: rect.x, y: rect.y, w: rect.width, h: rect.height, method: 'direct' };
        }
      }
      
      // Method 2: Shadow DOM traversal
      function searchShadowRoots(root) {
        const elements = root.querySelectorAll('*');
        for (const el of elements) {
          if (el.shadowRoot) {
            const iframes = el.shadowRoot.querySelectorAll('iframe');
            for (const iframe of iframes) {
              if (iframe.src && iframe.src.includes('challenges.cloudflare.com')) {
                const rect = iframe.getBoundingClientRect();
                return { found: true, x: rect.x, y: rect.y, w: rect.width, h: rect.height, method: 'shadow' };
              }
            }
            const found = searchShadowRoots(el.shadowRoot);
            if (found) return found;
          }
        }
        return null;
      }
      const shadowResult = searchShadowRoots(document);
      if (shadowResult) return shadowResult;
      
      // Method 3: Check all iframes regardless of src
      const allIframes = document.querySelectorAll('iframe');
      return { 
        found: false, 
        iframeCount: allIframes.length,
        iframeSrcs: Array.from(allIframes).map(f => f.src),
      };
    });
    console.log('Iframe info:', JSON.stringify(iframeInfo, null, 2));

    // Try to get iframe position from CDP
    console.log('\n=== CDP: Finding iframe position ===');
    try {
      // Get all nodes
      const doc = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
      
      // Search for iframe nodes
      function findIframes(node, path = '') {
        const results = [];
        if (node.nodeName === 'IFRAME') {
          results.push({
            nodeId: node.nodeId,
            name: node.attributes,
            path: path,
          });
        }
        for (const child of (node.children || [])) {
          results.push(...findIframes(child, path + '/' + node.nodeName));
        }
        return results;
      }
      
      const iframes = findIframes(doc.root);
      console.log('CDP found', iframes.length, 'iframes');
      for (const iframe of iframes) {
        console.log('  nodeId:', iframe.nodeId, 'path:', iframe.path);
        
        // Get iframe attributes
        try {
          const attrs = await cdp.send('DOM.getAttributes', { nodeId: iframe.nodeId });
          console.log('    attrs:', attrs.attributes);
        } catch(e) {}
        
        // Get iframe box model
        try {
          const box = await cdp.send('DOM.getBoxModel', { nodeId: iframe.nodeId });
          console.log('    box:', JSON.stringify(box.model.content));
        } catch(e) {}
      }
    } catch(e) {
      console.log('CDP error:', e.message);
    }

    // Try clicking inside the iframe using CDP
    console.log('\n=== Trying CDP click inside iframe ===');
    
    // First, let's try to find the iframe position by other means
    // Based on the screenshot, the Turnstile widget appears to be in the center-left area
    // Let's try clicking at various positions
    
    // Get page dimensions
    const pageSize = await page.evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight,
      scrollY: window.scrollY,
    }));
    console.log('Page size:', pageSize);

    // The Turnstile widget typically appears below the "Verifying your browser" text
    // Based on the screenshot, it should be around x=200-400, y=300-400
    // But we need to find the exact position

    // Let's try to find the widget by looking for the cf-turnstile-response input
    const inputPos = await page.evaluate(() => {
      const input = document.querySelector('input[name="cf-turnstile-response"]');
      if (!input) return null;
      const rect = input.getBoundingClientRect();
      return { x: rect.x, y: rect.y, w: rect.width, h: rect.height };
    });
    console.log('Input position:', inputPos);

    if (inputPos) {
      // The Turnstile widget should be near the input
      // Try clicking above the input (where the checkbox usually is)
      const clickPositions = [
        { x: inputPos.x + inputPos.w / 2, y: inputPos.y - 50, desc: 'above input' },
        { x: inputPos.x + inputPos.w / 2, y: inputPos.y - 30, desc: 'slightly above input' },
        { x: inputPos.x + inputPos.w / 2, y: inputPos.y + inputPos.h + 30, desc: 'below input' },
        { x: 300, y: 350, desc: 'estimated position' },
        { x: 400, y: 350, desc: 'estimated position 2' },
      ];

      for (const pos of clickPositions) {
        console.log(`\nTrying click at (${pos.x}, ${pos.y}) - ${pos.desc}`);
        
        await cdp.send('Input.dispatchMouseEvent', {
          type: 'mouseMoved', x: pos.x, y: pos.y,
        });
        await sleep(100);
        await cdp.send('Input.dispatchMouseEvent', {
          type: 'mousePressed', x: pos.x, y: pos.y, button: 'left', clickCount: 1,
        });
        await sleep(50);
        await cdp.send('Input.dispatchMouseEvent', {
          type: 'mouseReleased', x: pos.x, y: pos.y, button: 'left', clickCount: 1,
        });
        await sleep(3000);

        // Check token
        const token = await page.evaluate(() => {
          const input = document.querySelector('input[name="cf-turnstile-response"]');
          return input ? input.value : 'no input';
        });
        if (token && token.length > 10) {
          console.log('TOKEN FOUND!', token.substring(0, 50) + '...');
          break;
        }
        console.log('Token still empty');
      }
    }

    // Also try: use turnstile.reset() and then wait
    console.log('\n=== Trying turnstile.reset() approach ===');
    await page.evaluate(() => {
      try { turnstile.reset(); } catch(e) {}
    });
    await sleep(5000);

    // Try getResponse again
    const token = await page.evaluate(() => {
      try { return turnstile.getResponse() || null; } catch(e) { return null; }
    });
    console.log('getResponse after reset:', token ? token.substring(0, 50) + '...' : 'null');

    // Try: wait for the widget to auto-solve
    console.log('\n=== Waiting for auto-solve (30s) ===');
    for (let i = 0; i < 30; i++) {
      await sleep(1000);
      const t = await page.evaluate(() => {
        try { return turnstile.getResponse() || null; } catch(e) { return null; }
      });
      if (t) {
        console.log('AUTO-SOLVED at', i+1, 'seconds!');
        console.log('Token:', t.substring(0, 50) + '...');
        break;
      }
      if (i % 5 === 0) console.log('  Waiting...', i+1, 's');
    }
  }

  // Final screenshot
  await page.screenshot({ path: join(CONFIG.DEBUG_DIR, 'debug_click_2_final.png'), fullPage: true });

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
