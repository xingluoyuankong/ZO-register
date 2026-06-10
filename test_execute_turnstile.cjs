// ZO Register - turnstile.execute() + Shadow DOM 穿透
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

  await page.screenshot({ path: join(CONFIG.DEBUG_DIR, 'debug_exec_1.png'), fullPage: true });

  // === Step 1: Try turnstile.execute() ===
  console.log('\n=== Step 1: turnstile.execute() ===');
  try {
    const execResult = await page.evaluate(() => {
      try {
        turnstile.execute();
        return 'execute() called successfully';
      } catch(e) {
        return 'execute() error: ' + e.message;
      }
    });
    console.log(execResult);
    await sleep(10000); // Wait for challenge to process

    const tokenAfterExec = await page.evaluate(() => {
      try { return turnstile.getResponse() || null; } catch(e) { return null; }
    });
    console.log('Token after execute:', tokenAfterExec ? tokenAfterExec.substring(0, 50) + '...' : 'null');
  } catch(e) {
    console.log('Error:', e.message);
  }

  // === Step 2: Try to find and interact with Shadow DOM ===
  console.log('\n=== Step 2: Shadow DOM exploration ===');
  const frames = page.frames();
  const tsFrame = frames.find(f => f.url().includes('challenges.cloudflare.com'));

  if (tsFrame) {
    console.log('Turnstile frame found');

    // Try to access the frame's document directly
    try {
      const frameDoc = await tsFrame.evaluate(() => {
        // Check for shadow roots
        const all = document.querySelectorAll('*');
        const shadowRoots = [];
        for (const el of all) {
          if (el.shadowRoot) {
            shadowRoots.push({
              tag: el.tagName,
              id: el.id,
              class: el.className,
              childCount: el.shadowRoot.childElementCount,
              innerHTML: el.shadowRoot.innerHTML.substring(0, 500),
            });
          }
        }

        // Check for canvas elements
        const canvases = document.querySelectorAll('canvas');
        
        // Check for iframes inside shadow roots
        const nestedIframes = [];
        for (const sr of shadowRoots) {
          const iframes = sr.innerHTML.match(/<iframe[^>]*>/g) || [];
          nestedIframes.push(...iframes);
        }

        return {
          shadowRoots,
          canvasCount: canvases.length,
          nestedIframes,
          allElements: all.length,
          bodyChildren: document.body ? document.body.children.length : 0,
          bodyChildTags: document.body ? Array.from(document.body.children).map(c => c.tagName) : [],
        };
      });
      console.log('Frame document:', JSON.stringify(frameDoc, null, 2));
    } catch(e) {
      console.log('Cannot access frame document:', e.message);
    }

    // Try to click inside the frame using various methods
    console.log('\n=== Step 3: Clicking inside frame ===');
    
    // Method A: frame.click() on various selectors
    const selectors = ['body', 'div', 'input', 'button', '[role="checkbox"]', 'label'];
    for (const sel of selectors) {
      try {
        await tsFrame.click(sel).catch(() => {});
        console.log(`Clicked ${sel} in frame`);
        await sleep(2000);
      } catch(e) {}
    }

    // Method B: Use CDP to dispatch events in the frame
    console.log('\n=== Step 4: CDP events in frame ===');
    const cdp = await page.createCDPSession();
    
    // Try to find the frame's execution context
    try {
      await cdp.send('Runtime.enable');
      
      // Get all execution contexts
      const contexts = [];
      cdp.on('Runtime.executionContextCreated', (params) => {
        contexts.push({
          id: params.context.id,
          origin: params.context.origin,
          name: params.context.name,
        });
      });

      // Trigger a frame reload to get context events
      await tsFrame.evaluate(() => {});
      await sleep(1000);

      console.log('Execution contexts:', contexts.length);
      for (const ctx of contexts) {
        if (ctx.origin && ctx.origin.includes('challenges.cloudflare.com')) {
          console.log('Found Turnstile context:', ctx.id, ctx.origin);
          
          // Try to evaluate in this context
          try {
            const result = await cdp.send('Runtime.evaluate', {
              expression: `
                (function() {
                  try {
                    turnstile.execute();
                    return 'executed in context';
                  } catch(e) {
                    return 'error: ' + e.message;
                  }
                })()
              `,
              contextId: ctx.id,
              returnByValue: true,
            });
            console.log('Result in context:', result.result.value);
          } catch(e) {
            console.log('Error in context:', e.message);
          }
        }
      }
    } catch(e) {
      console.log('CDP error:', e.message);
    }

    // Method C: Try to find the widget by looking at the page layout
    console.log('\n=== Step 5: Page layout analysis ===');
    const layout = await page.evaluate(() => {
      const elements = document.querySelectorAll('*');
      const visible = [];
      for (const el of elements) {
        const rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0 && rect.width < 500 && rect.height < 200) {
          const style = window.getComputedStyle(el);
          if (style.display !== 'none' && style.visibility !== 'hidden') {
            visible.push({
              tag: el.tagName,
              id: el.id,
              class: el.className,
              x: Math.round(rect.x),
              y: Math.round(rect.y),
              w: Math.round(rect.width),
              h: Math.round(rect.height),
              text: el.textContent ? el.textContent.substring(0, 30) : '',
            });
          }
        }
      }
      return visible;
    });
    console.log('Visible elements:', JSON.stringify(layout.slice(0, 20), null, 2));

    // Try clicking on the "Continue in browser" button
    console.log('\n=== Step 6: Clicking "Continue in browser" ===');
    const continueBtn = await page.evaluate(() => {
      const buttons = document.querySelectorAll('button, a, [role="button"]');
      for (const btn of buttons) {
        if (btn.textContent && btn.textContent.includes('Continue in browser')) {
          const rect = btn.getBoundingClientRect();
          return { found: true, x: rect.x + rect.width/2, y: rect.y + rect.height/2, text: btn.textContent };
        }
      }
      return { found: false };
    });
    console.log('Continue button:', continueBtn);

    if (continueBtn.found) {
      const cdp2 = await page.createCDPSession();
      await cdp2.send('Input.dispatchMouseEvent', {
        type: 'mouseMoved', x: continueBtn.x, y: continueBtn.y,
      });
      await sleep(100);
      await cdp2.send('Input.dispatchMouseEvent', {
        type: 'mousePressed', x: continueBtn.x, y: continueBtn.y, button: 'left', clickCount: 1,
      });
      await sleep(50);
      await cdp2.send('Input.dispatchMouseEvent', {
        type: 'mouseReleased', x: continueBtn.x, y: continueBtn.y, button: 'left', clickCount: 1,
      });
      console.log('Clicked Continue button');
      await sleep(5000);

      // Check token after clicking
      const tokenAfterContinue = await page.evaluate(() => {
        const input = document.querySelector('input[name="cf-turnstile-response"]');
        return input ? input.value : 'no input';
      });
      console.log('Token after Continue:', tokenAfterContinue ? tokenAfterContinue.substring(0, 50) + '...' : 'empty');
    }
  }

  // Final screenshot
  await page.screenshot({ path: join(CONFIG.DEBUG_DIR, 'debug_exec_2.png'), fullPage: true });

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
