const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.connectOverCDP('http://localhost:9222');
  const context = browser.contexts()[0];
  const page = await context.newPage();

  await page.goto('https://www.zo.computer/signup', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await new Promise(r => setTimeout(r, 5000));

  // Test if Turnstile Patcher is working
  const testResult = await page.evaluate(() => {
    const evt = new MouseEvent('click', { clientX: 100, clientY: 200 });
    return {
      clientX: evt.clientX,
      clientY: evt.clientY,
      screenX: evt.screenX,
      screenY: evt.screenY,
      screenXEqualsClientX: evt.screenX === evt.clientX,
      screenYEqualsClientY: evt.screenY === evt.clientY,
      webdriver: navigator.webdriver
    };
  });

  console.log('MouseEvent test:', JSON.stringify(testResult, null, 2));

  if (testResult.screenXEqualsClientX === false && testResult.screenYEqualsClientY === false) {
    console.log('✅ Turnstile Patcher: WORKING - screenX/screenY are properly offset');
  } else {
    console.log('❌ Turnstile Patcher: NOT WORKING - screenX still equals clientX');
  }

  if (testResult.webdriver === undefined) {
    console.log('✅ navigator.webdriver patch: WORKING');
  } else {
    console.log('❌ navigator.webdriver patch: NOT WORKING (value:', testResult.webdriver, ')');
  }

  // Check Turnstile on page
  const turnstileInfo = await page.evaluate(() => {
    const widgets = document.querySelectorAll('.cf-turnstile, [data-sitekey]');
    const iframes = document.querySelectorAll('iframe');
    const turnstileIframes = [];
    for (const iframe of iframes) {
      const src = (iframe.src || '').toLowerCase();
      if (src.includes('challenges.cloudflare') || src.includes('turnstile')) {
        const rect = iframe.getBoundingClientRect();
        turnstileIframes.push({ src: src.substring(0, 80), x: rect.x, y: rect.y, w: rect.width, h: rect.height });
      }
    }
    const turnstileApi = !!window.turnstile;
    return { widgetCount: widgets.length, turnstileIframes, turnstileApiLoaded: turnstileApi };
  });

  console.log('\nTurnstile info:', JSON.stringify(turnstileInfo, null, 2));
  console.log('Page URL:', page.url());

  // Check what's on the page
  const pageText = await page.evaluate(() => document.body.innerText.substring(0, 500));
  console.log('\nPage text (first 500 chars):\n', pageText);

  await page.close();
  browser.close();
  console.log('\nTest complete!');
})();
