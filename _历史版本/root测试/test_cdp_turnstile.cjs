// ZO Register - CDP 直接操作 Turnstile
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
  var X=800+Math.floor(Math.random()*400),Y=400+Math.floor(Math.random()*200);
  Object.defineProperty(MouseEvent.prototype,'screenX',{value:X});
  Object.defineProperty(MouseEvent.prototype,'screenY',{value:Y});
  Object.defineProperty(PointerEvent.prototype,'screenX',{value:X});
  Object.defineProperty(PointerEvent.prototype,'screenY',{value:Y});
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

  // Take initial screenshot
  await page.screenshot({ path: join(CONFIG.DEBUG_DIR, 'debug_cdp_1_initial.png'), fullPage: true });

  // Use CDP to find all frames
  const cdpSession = await page.createCDPSession();
  
  // Get frame tree
  console.log('\n=== CDP Frame Tree ===');
  let frameTree;
  try {
    frameTree = await cdpSession.send('Page.getFrameTree');
    console.log('Frame tree keys:', Object.keys(frameTree));
    console.log('Frame tree type:', typeof frameTree);
    if (frameTree.frameTree) {
      console.log('Has nested frameTree property');
      frameTree = frameTree.frameTree;
    }
  } catch(e) {
    console.log('Error getting frame tree:', e.message);
  }
  function printFrameTree(node, indent = '') {
    if (!node || !node.frame) return;
    const url = node.frame.url || '';
    const name = node.frame.name || '';
    console.log(`${indent}Frame: ${url.substring(0, 100)}`);
    if (name) console.log(`${indent}  Name: ${name}`);
    console.log(`${indent}  ID: ${node.frame.id}`);
    for (const child of (node.childFrames || [])) {
      printFrameTree(child, indent + '  ');
    }
  }
  printFrameTree(frameTree);

  // Find the Turnstile frame
  function findTurnstileFrame(node) {
    if (!node || !node.frame) return null;
    if ((node.frame.url || '').includes('challenges.cloudflare.com')) return node.frame;
    for (const child of (node.childFrames || [])) {
      const found = findTurnstileFrame(child);
      if (found) return found;
    }
    return null;
  }
  const turnstileFrameInfo = findTurnstileFrame(frameTree);

  if (turnstileFrameInfo) {
    console.log('\n=== Found Turnstile Frame ===');
    console.log('Frame ID:', turnstileFrameInfo.id);
    console.log('URL:', turnstileFrameInfo.url);

    // Use CDP to evaluate in the Turnstile frame context
    console.log('\n=== Evaluating in Turnstile frame ===');
    
    // First, get the document
    try {
      const docResult = await cdpSession.send('Runtime.evaluate', {
        expression: `
          (function() {
            return {
              title: document.title,
              readyState: document.readyState,
              bodyHTML: document.body ? document.body.outerHTML.substring(0, 2000) : 'no body',
              headHTML: document.head ? document.head.outerHTML.substring(0, 1000) : 'no head',
              allScripts: Array.from(document.querySelectorAll('script')).map(s => s.src || s.textContent.substring(0, 100)),
            };
          })()
        `,
        returnByValue: true,
        contextId: undefined, // Use main context
      });
      console.log('Document info:', JSON.stringify(docResult.result.value, null, 2));
    } catch(e) {
      console.log('Error evaluating in frame:', e.message);
    }

    // Try to get the frame's execution context
    console.log('\n=== Getting frame execution context ===');
    try {
      // Enable Runtime
      await cdpSession.send('Runtime.enable');
      
      // Get all execution contexts
      cdpSession.on('Runtime.executionContextCreated', (params) => {
        const ctx = params.context;
        if (ctx.origin && ctx.origin.includes('challenges.cloudflare.com')) {
          console.log('Found Turnstile execution context:', ctx.id, ctx.origin);
        }
      });

      // Evaluate in the specific frame
      const result = await cdpSession.send('Runtime.evaluate', {
        expression: `
          (function() {
            try {
              const el = document.querySelector('[data-action]');
              return {
                found: !!el,
                action: el ? el.getAttribute('data-action') : null,
                bodyText: document.body ? document.body.innerText : '',
                bodyHTML: document.body ? document.body.innerHTML.substring(0, 3000) : '',
                checkbox: !!document.querySelector('input[type="checkbox"]'),
                allElements: document.querySelectorAll('*').length,
              };
            } catch(e) {
              return { error: e.message };
            }
          })()
        `,
        returnByValue: true,
      });
      console.log('Turnstile frame content:', JSON.stringify(result.result.value, null, 2));
    } catch(e) {
      console.log('Error:', e.message);
    }

    // Try to find the checkbox using CDP DOM methods
    console.log('\n=== CDP DOM Search ===');
    try {
      const domResult = await cdpSession.send('Runtime.evaluate', {
        expression: `
          (function() {
            // Look for all elements with event listeners
            const all = document.querySelectorAll('*');
            const clickable = [];
            for (const el of all) {
              const rect = el.getBoundingClientRect();
              if (rect.width > 0 && rect.height > 0) {
                clickable.push({
                  tag: el.tagName,
                  id: el.id,
                  class: el.className,
                  type: el.type || '',
                  role: el.getAttribute('role') || '',
                  x: Math.round(rect.x),
                  y: Math.round(rect.y),
                  w: Math.round(rect.width),
                  h: Math.round(rect.height),
                });
              }
            }
            return clickable;
          })()
        `,
        returnByValue: true,
      });
      console.log('Clickable elements:', JSON.stringify(domResult.result.value, null, 2));
    } catch(e) {
      console.log('Error:', e.message);
    }

    // Try to click at the center of the iframe on the page
    console.log('\n=== Clicking Turnstile iframe on page ===');
    
    // Find iframe element using CDP
    const iframeNode = await cdpSession.send('Runtime.evaluate', {
      expression: `
        (function() {
          const iframes = document.querySelectorAll('iframe');
          for (const iframe of iframes) {
            if (iframe.src && iframe.src.includes('challenges.cloudflare.com')) {
              const rect = iframe.getBoundingClientRect();
              return {
                found: true,
                x: rect.x,
                y: rect.y,
                width: rect.width,
                height: rect.height,
                src: iframe.src.substring(0, 100),
              };
            }
          }
          // Try shadow DOM
          const all = document.querySelectorAll('*');
          for (const el of all) {
            if (el.shadowRoot) {
              const iframes = el.shadowRoot.querySelectorAll('iframe');
              for (const iframe of iframes) {
                if (iframe.src && iframe.src.includes('challenges.cloudflare.com')) {
                  const rect = iframe.getBoundingClientRect();
                  return {
                    found: true,
                    x: rect.x,
                    y: rect.y,
                    width: rect.width,
                    height: rect.height,
                    src: iframe.src.substring(0, 100),
                    inShadow: true,
                  };
                }
              }
            }
          }
          return { found: false };
        })()
      `,
      returnByValue: true,
    });
    console.log('Iframe node:', JSON.stringify(iframeNode.result.value, null, 2));

    if (iframeNode.result.value && iframeNode.result.value.found) {
      const iframe = iframeNode.result.value;
      const clickX = iframe.x + iframe.width / 2;
      const clickY = iframe.y + iframe.height / 2;
      console.log(`\nClicking at (${clickX}, ${clickY})`);
      
      // Use CDP Input.dispatchMouseEvent
      await cdpSession.send('Input.dispatchMouseEvent', {
        type: 'mouseMoved', x: clickX, y: clickY,
      });
      await sleep(100);
      await cdpSession.send('Input.dispatchMouseEvent', {
        type: 'mousePressed', x: clickX, y: clickY, button: 'left', clickCount: 1,
      });
      await sleep(50);
      await cdpSession.send('Input.dispatchMouseEvent', {
        type: 'mouseReleased', x: clickX, y: clickY, button: 'left', clickCount: 1,
      });
      console.log('Click sent');
      await sleep(5000);

      // Check token
      const token = await page.evaluate(() => {
        const input = document.querySelector('input[name="cf-turnstile-response"]');
        return input ? input.value : 'no input';
      });
      console.log('Token after click:', token ? token.substring(0, 50) + '...' : 'empty');
    }
  }

  // Final screenshot
  await page.screenshot({ path: join(CONFIG.DEBUG_DIR, 'debug_cdp_2_final.png'), fullPage: true });

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
