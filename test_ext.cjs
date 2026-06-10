const puppeteer = require('E:\\API获取工具\\ZO注册\\node_modules\\puppeteer-core');
(async () => {
  const browser = await puppeteer.connect({ browserURL: 'http://localhost:9222', defaultViewport: null, timeout: 10000 });
  
  // Check service workers and background pages
  const targets = browser.targets();
  console.log('All targets:');
  for (const t of targets) {
    console.log('  type=' + t.type() + ' url=' + t.url());
  }
  
  // Check if extension content script runs on a new page
  const page = await browser.newPage();
  await page.goto('https://www.zo.computer/signup', { waitUntil: 'domcontentloaded', timeout: 15000 });
  await new Promise(r => setTimeout(r, 3000));
  
  const result = await page.evaluate(() => {
    return {
      cfBypass: !!window.__CF_BYPASS__,
      webdriver: navigator.webdriver,
      plugins: navigator.plugins.length,
      screenX_test: (() => {
        try {
          const evt = new MouseEvent('mousemove', { clientX: 100, clientY: 100 });
          return { clientX: evt.clientX, screenX: evt.screenX, diff: evt.screenX - evt.clientX };
        } catch(e) { return { error: e.message }; }
      })()
    };
  });
  console.log('Page check:', JSON.stringify(result, null, 2));
  
  await page.close();
  browser.disconnect();
})().catch(e => console.error('Error:', e.message));
