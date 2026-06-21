// ZO Register - Turnstile iframe 交互测试
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
  await sleep(5000);

  // Find the Turnstile frame
  const frames = page.frames();
  console.log('\nFrames:', frames.length);
  const turnstileFrame = frames.find(f => f.url().includes('challenges.cloudflare.com'));
  
  if (!turnstileFrame) {
    console.log('No Turnstile frame found!');
    await context.close();
    browser.disconnect();
    return;
  }

  console.log('Turnstile frame URL:', turnstileFrame.url().substring(0, 120));

  // Inject patch into Turnstile iframe
  console.log('\n--- Injecting patch into Turnstile iframe ---');
  try {
    await turnstileFrame.evaluate(() => {
      const X = 800 + Math.floor(Math.random() * 400);
      const Y = 400 + Math.floor(Math.random() * 200);
      Object.defineProperty(MouseEvent.prototype, 'screenX', { value: X });
      Object.defineProperty(MouseEvent.prototype, 'screenY', { value: Y });
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      window.__CF_PATCHED__ = true;
    });
    console.log('Patch injected successfully');
  } catch(e) {
    console.log('Patch injection failed:', e.message);
  }

  // Explore the Turnstile iframe content
  console.log('\n--- Exploring Turnstile iframe content ---');
  try {
    const iframeContent = await turnstileFrame.evaluate(() => {
      return {
        bodyText: document.body ? document.body.innerText.substring(0, 500) : 'no body',
        bodyHTML: document.body ? document.body.innerHTML.substring(0, 1000) : 'no body',
        inputs: document.querySelectorAll('input').length,
        buttons: document.querySelectorAll('button').length,
        divs: document.querySelectorAll('div').length,
        iframes: document.querySelectorAll('iframe').length,
        shadowRoots: Array.from(document.querySelectorAll('*')).filter(el => el.shadowRoot).length,
        allElements: document.querySelectorAll('*').length,
        cfPatched: window.__CF_PATCHED__ || false,
      };
    });
    console.log(JSON.stringify(iframeContent, null, 2));
  } catch(e) {
    console.log('Cannot access iframe content:', e.message);
  }

  // Try to find and click the checkbox
  console.log('\n--- Looking for checkbox in iframe ---');
  try {
    // First, check if there's a shadow root inside the iframe
    const shadowInfo = await turnstileFrame.evaluate(() => {
      const allElements = document.querySelectorAll('*');
      const withShadow = [];
      for (const el of allElements) {
        if (el.shadowRoot) {
          withShadow.push({
            tag: el.tagName,
            id: el.id,
            class: el.className,
            childCount: el.shadowRoot.childElementCount,
            innerHTML: el.shadowRoot.innerHTML ? el.shadowRoot.innerHTML.substring(0, 200) : '',
          });
        }
      }
      return withShadow;
    });
    console.log('Shadow roots in iframe:', JSON.stringify(shadowInfo, null, 2));

    // Try to find the checkbox/input
    const inputInfo = await turnstileFrame.evaluate(() => {
      const inputs = document.querySelectorAll('input');
      return Array.from(inputs).map(inp => ({
        type: inp.type,
        name: inp.name,
        id: inp.id,
        checked: inp.checked,
        visible: inp.offsetParent !== null,
        rect: inp.getBoundingClientRect(),
      }));
    });
    console.log('Inputs in iframe:', JSON.stringify(inputInfo, null, 2));

    // Try to click on the iframe body
    console.log('\n--- Clicking in iframe ---');
    await turnstileFrame.click('body').catch(() => {});
    console.log('Clicked body');
    await sleep(3000);

    // Check response after click
    const token = await page.evaluate(() => {
      const input = document.querySelector('input[name="cf-turnstile-response"]');
      return input ? input.value : 'no input';
    });
    console.log('Token after click:', token ? token.substring(0, 50) + '...' : 'empty');

    // Try clicking at specific coordinates (center of iframe)
    console.log('\n--- Clicking at iframe center ---');
    const iframeElement = await turnstileFrame.evaluate(() => {
      return {
        width: document.documentElement.clientWidth,
        height: document.documentElement.clientHeight,
      };
    });
    console.log('Iframe size:', iframeElement);

    // Use CDP to click inside the iframe
    const cdpSession = await page.createCDPSession();
    
    // Get iframe position on page
    const iframePos = await page.evaluate(() => {
      const iframes = document.querySelectorAll('iframe');
      for (const iframe of iframes) {
        if (iframe.src && iframe.src.includes('challenges.cloudflare.com')) {
          const rect = iframe.getBoundingClientRect();
          return {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
            src: iframe.src.substring(0, 100),
          };
        }
      }
      return null;
    });
    console.log('Iframe position on page:', JSON.stringify(iframePos, null, 2));

    if (iframePos) {
      // Click in the center of the iframe
      const clickX = iframePos.x + iframePos.width / 2;
      const clickY = iframePos.y + iframePos.height / 2;
      console.log(`Clicking at page coordinates: (${clickX}, ${clickY})`);
      
      await cdpSession.send('Input.dispatchMouseEvent', {
        type: 'mousePressed', x: clickX, y: clickY, button: 'left', clickCount: 1,
      });
      await cdpSession.send('Input.dispatchMouseEvent', {
        type: 'mouseReleased', x: clickX, y: clickY, button: 'left', clickCount: 1,
      });
      console.log('CDP click sent');
      await sleep(5000);

      // Check response after CDP click
      const token2 = await page.evaluate(() => {
        const input = document.querySelector('input[name="cf-turnstile-response"]');
        return input ? input.value : 'no input';
      });
      console.log('Token after CDP click:', token2 ? token2.substring(0, 50) + '...' : 'empty');
    }

    // Try clicking directly inside the iframe using frame click
    console.log('\n--- Clicking inside iframe at center ---');
    try {
      await turnstileFrame.click('div, span, label, [role="checkbox"]').catch(() => {});
      console.log('Clicked element in iframe');
      await sleep(3000);
    } catch(e) {
      console.log('Click in iframe error:', e.message);
    }

    // Final token check
    const finalToken = await page.evaluate(() => {
      const input = document.querySelector('input[name="cf-turnstile-response"]');
      return input ? input.value : 'no input';
    });
    console.log('\nFinal token:', finalToken ? finalToken.substring(0, 50) + '...' : 'empty');

  } catch(e) {
    console.log('Error:', e.message);
  }

  // Final screenshot
  await page.screenshot({ path: join(CONFIG.DEBUG_DIR, 'debug_turnstile_3_final.png'), fullPage: true });

  await context.close();
  browser.disconnect();
  console.log('\nDone!');
})().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
