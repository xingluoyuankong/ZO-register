// ZO Register - Turnstile 专用测试
// 核心: Shadow DOM 穿透 + iframe 内部注入 + checkbox 点击
const puppeteer = require('E:\\API获取工具\\ZO注册\\node_modules\\puppeteer-core');
const { readFileSync } = require('fs');
const { join } = require('path');

const CONFIG = {
  EMAIL_DIR: "C:\\Users\\XZXyuan\\Downloads\\批量注册邮箱\\已经使用",
  GRAPH_TOKEN_URL: "https://login.microsoftonline.com/consumers/oauth2/v2.0/token",
  GRAPH_MAIL_URL: "https://graph.microsoft.com/v1.0/me/messages",
  DEBUG_DIR: "E:\\API获取工具\\ZO注册\\registered",
};

// 主页面补丁 - screenX/screenY
const MAIN_PATCH = `(function(){
  if(window.__CF_BYPASS__)return;window.__CF_BYPASS__=true;
  var X=800+Math.floor(Math.random()*400),Y=400+Math.floor(Math.random()*200);
  Object.defineProperty(MouseEvent.prototype,'screenX',{value:X});
  Object.defineProperty(MouseEvent.prototype,'screenY',{value:Y});
  Object.defineProperty(PointerEvent.prototype,'screenX',{value:X});
  Object.defineProperty(PointerEvent.prototype,'screenY',{value:Y});
  Object.defineProperty(navigator,'webdriver',{get:()=>undefined});
})();`;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function getMagicLink(email, password, clientId, refreshToken) {
  const body = new URLSearchParams({
    client_id: clientId, grant_type: 'refresh_token', refresh_token: refreshToken,
    scope: 'https://graph.microsoft.com/.default offline_access',
  });
  const tokenResp = await fetch(CONFIG.GRAPH_TOKEN_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString(),
  });
  const tokenData = await tokenResp.json();
  const accessToken = tokenData.access_token;

  // Send email
  console.log('Sending magic link...');
  const sendResp = await fetch('https://www.zo.computer/api/email-login/request', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  console.log('Send status:', sendResp.status);
  await sleep(8000);

  // Poll for email
  for (let i = 0; i < 20; i++) {
    const mailResp = await fetch(CONFIG.GRAPH_MAIL_URL + '?$top=3&$select=subject,body,receivedDateTime&$orderby=receivedDateTime%20desc', {
      headers: { Authorization: 'Bearer ' + accessToken }
    });
    const mail = await mailResp.json();
    for (const msg of (mail.value || [])) {
      const combined = (msg.subject || '') + ' ' + ((msg.body && msg.body.content) || '');
      const links = combined.match(/https:\/\/www\.zo\.computer\/api\/email-login\/verify[^\s"'<>]*/gi) || [];
      let link = links[0] || '';
      link = link.replace(/[)\]>,;!?\s]+$/, '').replace(/&amp;/g, '&');
      if (link && link.includes('token=')) return link;
    }
    console.log(`  Poll ${i+1}/20...`);
    await sleep(5000);
  }
  return null;
}

(async () => {
  const browser = await puppeteer.connect({ browserURL: 'http://localhost:9222', defaultViewport: null, timeout: 10000 });

  // Get email
  const emailFile = join(CONFIG.EMAIL_DIR, 'sanchezquinncu3w1kkhtuc74@outlook.com__Pxcuyi6K50yVZPnD.txt');
  const content = readFileSync(emailFile, 'utf-8').trim();
  const [email, password, clientId, refreshToken] = content.split('----').map(s => s.trim());

  const link = await getMagicLink(email, password, clientId, refreshToken);
  if (!link) { console.log('No magic link found!'); process.exit(1); }
  console.log('Got link:', link.substring(0, 80) + '...');

  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  // Inject main page patch BEFORE navigating
  await page.evaluateOnNewDocument(MAIN_PATCH);

  console.log('\n--- Opening magic link ---');
  await page.goto(link, { waitUntil: 'networkidle0', timeout: 60000 }).catch(() => {});
  await sleep(5000);

  // Take screenshot
  await page.screenshot({ path: join(CONFIG.DEBUG_DIR, 'debug_turnstile_1_initial.png'), fullPage: true });

  // === Step 1: Check if Turnstile input exists ===
  const turnstileInfo = await page.evaluate(() => {
    const input = document.querySelector('input[name="cf-turnstile-response"]');
    return {
      exists: !!input,
      value: input ? input.value : null,
      parentHTML: input ? input.parentElement.outerHTML.substring(0, 500) : null,
    };
  });
  console.log('\n=== Turnstile Input ===');
  console.log(JSON.stringify(turnstileInfo, null, 2));

  // === Step 2: Try turnstile.reset() and getResponse() ===
  console.log('\n=== Trying turnstile.reset() + getResponse() ===');
  const resetResult = await page.evaluate(() => {
    try { turnstile.reset(); return 'reset OK'; } catch(e) { return 'reset error: ' + e.message; }
  });
  console.log('Reset:', resetResult);
  await sleep(3000);

  const token1 = await page.evaluate(() => {
    try { return turnstile.getResponse() || null; } catch(e) { return 'error: ' + e.message; }
  });
  console.log('getResponse:', token1 ? (typeof token1 === 'string' ? token1.substring(0, 50) + '...' : token1) : 'null');

  // === Step 3: Find Shadow DOM and iframe ===
  console.log('\n=== Looking for Shadow DOM ===');
  const shadowInfo = await page.evaluate(() => {
    const input = document.querySelector('input[name="cf-turnstile-response"]');
    if (!input) return { error: 'no input' };
    
    const parent = input.parentElement;
    const hasShadowRoot = !!parent.shadowRoot;
    
    // Check all parents for shadow roots
    let el = parent;
    const shadowRoots = [];
    while (el) {
      if (el.shadowRoot) {
        shadowRoots.push({
          tag: el.tagName,
          id: el.id,
          class: el.className,
          childCount: el.shadowRoot.childNodes.length,
          iframes: el.shadowRoot.querySelectorAll('iframe').length,
        });
      }
      el = el.parentElement;
    }
    
    // Also check for iframes in main document
    const mainIframes = document.querySelectorAll('iframe').length;
    
    return {
      parentTag: parent.tagName,
      parentId: parent.id,
      parentClass: parent.className,
      hasShadowRoot,
      shadowRoots,
      mainIframes,
    };
  });
  console.log(JSON.stringify(shadowInfo, null, 2));

  // === Step 4: Use puppeteer frames() ===
  console.log('\n=== Puppeteer Frames ===');
  const frames = page.frames();
  console.log('Total frames:', frames.length);
  for (const frame of frames) {
    console.log('  Frame:', frame.url().substring(0, 100));
    try {
      const name = frame.name();
      console.log('    Name:', name || '(none)');
    } catch(e) {}
  }

  // === Step 5: Try to access Shadow DOM via CDP ===
  console.log('\n=== CDP Shadow DOM Access ===');
  const cdpSession = await page.createCDPSession();
  
  // Find the cf-turnstile-response input and traverse up to find shadow root
  const shadowDomResult = await cdpSession.send('Runtime.evaluate', {
    expression: `
      (function() {
        const input = document.querySelector('input[name="cf-turnstile-response"]');
        if (!input) return { error: 'no input' };
        
        let el = input.parentElement;
        const results = [];
        while (el) {
          if (el.shadowRoot) {
            const iframes = el.shadowRoot.querySelectorAll('iframe');
            results.push({
              tag: el.tagName,
              id: el.id,
              class: el.className,
              iframeCount: iframes.length,
              iframeSrcs: Array.from(iframes).map(f => f.src),
            });
          }
          el = el.parentElement;
        }
        return { shadowRoots: results };
      })()
    `,
    returnByValue: true,
  });
  console.log(JSON.stringify(shadowDomResult.result.value, null, 2));

  // === Step 6: If we found shadow root with iframe, try to access it ===
  if (shadowDomResult.result.value && shadowDomResult.result.value.shadowRoots) {
    for (const sr of shadowDomResult.result.value.shadowRoots) {
      if (sr.iframeCount > 0) {
        console.log('\n=== Found iframe in Shadow DOM! ===');
        console.log('Parent:', sr.tag, '#' + sr.id, '.' + sr.class);
        console.log('Iframe srcs:', sr.iframeSrcs);
        
        // Use CDP to access the shadow root and get the iframe
        const iframeAccess = await cdpSession.send('Runtime.evaluate', {
          expression: `
            (function() {
              const input = document.querySelector('input[name="cf-turnstile-response"]');
              let el = input.parentElement;
              while (el) {
                if (el.shadowRoot) {
                  const iframe = el.shadowRoot.querySelector('iframe');
                  if (iframe) {
                    return {
                      found: true,
                      iframeSrc: iframe.src,
                      iframeWidth: iframe.width,
                      iframeHeight: iframe.height,
                      iframeStyle: iframe.getAttribute('style'),
                    };
                  }
                }
                el = el.parentElement;
              }
              return { found: false };
            })()
          `,
          returnByValue: true,
        });
        console.log(JSON.stringify(iframeAccess.result.value, null, 2));
        
        // Try to find the Turnstile frame in puppeteer
        const turnstileFrame = frames.find(f => f.url().includes('challenges.cloudflare.com'));
        if (turnstileFrame) {
          console.log('\n=== Found Turnstile frame in puppeteer! ===');
          console.log('Frame URL:', turnstileFrame.url());
          
          // Inject patch into the iframe
          await turnstileFrame.evaluate(() => {
            const X = 800 + Math.floor(Math.random() * 400);
            const Y = 400 + Math.floor(Math.random() * 200);
            Object.defineProperty(MouseEvent.prototype, 'screenX', { value: X });
            Object.defineProperty(MouseEvent.prototype, 'screenY', { value: Y });
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
          });
          console.log('Injected patch into Turnstile iframe');
          
          // Try to find and click the checkbox
          const checkboxInfo = await turnstileFrame.evaluate(() => {
            const inputs = document.querySelectorAll('input');
            const buttons = document.querySelectorAll('button');
            const bodies = document.querySelectorAll('body');
            return {
              inputs: inputs.length,
              buttons: buttons.length,
              bodies: bodies.length,
              bodyHTML: document.body ? document.body.innerHTML.substring(0, 500) : 'no body',
            };
          });
          console.log('Iframe content:', JSON.stringify(checkboxInfo, null, 2));
          
          // Try clicking in the iframe
          try {
            await turnstileFrame.click('body').catch(() => {});
            console.log('Clicked body in Turnstile iframe');
            await sleep(5000);
          } catch(e) {
            console.log('Click error:', e.message);
          }
        }
      }
    }
  }

  // === Step 7: Final state ===
  await sleep(5000);
  await page.screenshot({ path: join(CONFIG.DEBUG_DIR, 'debug_turnstile_2_after.png'), fullPage: true });
  
  const finalToken = await page.evaluate(() => {
    const input = document.querySelector('input[name="cf-turnstile-response"]');
    return input ? input.value : 'no input';
  });
  console.log('\n=== Final State ===');
  console.log('Turnstile token:', finalToken ? finalToken.substring(0, 50) + '...' : 'empty');
  console.log('URL:', page.url());

  await context.close();
  browser.disconnect();
  console.log('\nDone!');
})().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
