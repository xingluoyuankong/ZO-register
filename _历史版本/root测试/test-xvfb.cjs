const pptr = require('puppeteer-extra');
const Stealth = require('puppeteer-extra-plugin-stealth');
pptr.use(Stealth());

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  // Use virtual display
  const b = await pptr.launch({
    headless: false,
    args: [
      '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled',
      '--user-agent=Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
    ]
  });
  const p = await b.newPage();
  await p.setViewport({ width: 1440, height: 900 });

  // ★ 注入 Turnstile 绕过补丁
  await p.evaluateOnNewDocument(() => {
    if (window.__TURNSTILE_PATCHED__) return;
    window.__TURNSTILE_PATCHED__ = true;
    var _offX = Math.floor(Math.random() * 121) + 80;
    var _offY = Math.floor(Math.random() * 91) + 60;
    try { Object.defineProperty(MouseEvent.prototype, 'screenX', { get: function() { return (this.clientX||0) + _offX; }, configurable: true }); } catch(e) {}
    try { Object.defineProperty(MouseEvent.prototype, 'screenY', { get: function() { return (this.clientY||0) + _offY; }, configurable: true }); } catch(e) {}
    try { Object.defineProperty(PointerEvent.prototype, 'screenX', { get: function() { return (this.clientX||0) + _offX; }, configurable: true }); } catch(e) {}
    try { Object.defineProperty(PointerEvent.prototype, 'screenY', { get: function() { return (this.clientY||0) + _offY; }, configurable: true }); } catch(e) {}
  });

  const magicLink = 'https://www.zo.computer/api/email-login/verify?redirect=%2Fsignup&token=eyJhbGciOiJFUzI1NiIsImtpZCI6IjkxYmU5Yjk3LTMzM2ItNDQxMC04NmEwLTUyYTUyNzAwZDcxNSIsInR5cCI6IkpXVCJ9.eyJlbWFpbCI6ImhpbGxqdWxpYTVlczd5ODFjNnU4YUBvdXRsb29rLmNvbSIsIm5vbmNlIjoiNzVhYmU1MTMtMTY1My00ZDYwLWE2YjQtODA5NWZkYzNlMmIzIiwiZXhwIjoxNzgwNTkzNDczLCJpc3MiOiJodHRwczovL2F1dGguem8uY29tcHV0ZXIiLCJhdWQiOiJvbi1zdWJzdHJhdGUifQ.jlTCBNTBpUiHUn6QvaMxUt9l4HCKHc-fnxhqyzcgnB4o6Zre0mCOSpQsHwm3b8KzIZxgsrAPeNfxwc5RhEeHfA';

  console.log('Opening magic link...');
  try {
    await p.goto(magicLink, { waitUntil: 'domcontentloaded', timeout: 60000 });
  } catch(e) {}
  
  await sleep(3000);
  let bodyText = await p.evaluate(() => document.body.innerText.substring(0, 500));
  console.log('Initial:', bodyText.substring(0, 100));

  // Wait for Turnstile
  for (let i = 1; i <= 30; i++) {
    await sleep(5000);
    bodyText = await p.evaluate(() => document.body.innerText.substring(0, 500));
    
    if (/choose your handle/i.test(bodyText)) {
      console.log(`[${i}] REACHED HANDLE PAGE!`);
      break;
    }

    // Click Continue in browser if visible
    const clicked = await p.evaluate(() => {
      for (const el of document.querySelectorAll('button, a, span')) {
        if (/continue in browser/i.test(el.textContent.trim()) && el.offsetParent !== null) {
          el.click(); return true;
        }
      }
      return false;
    }).catch(() => false);

    if (clicked) {
      console.log(`[${i}] Clicked Continue in browser, waiting 8s...`);
      await sleep(8000);
      continue;
    }

    if (/invalid|expired/i.test(bodyText) && !/redirecting|check/i.test(bodyText)) {
      console.log(`[${i}] EXPIRED:`, bodyText.substring(0, 80));
      await p.screenshot({ path: '/tmp/zo-xvfb-fail.png' });
      break;
    }

    if (/browser check|verifying/i.test(bodyText)) {
      console.log(`[${i}] Still checking...`);
      continue;
    }

    if (i % 3 === 0) console.log(`[${i}] State:`, bodyText.substring(0, 80));
  }

  await p.screenshot({ path: '/tmp/zo-xvfb-final.png' });
  console.log('Final URL:', p.url());
  await b.close();
})();
