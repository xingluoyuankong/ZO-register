const puppeteer = require('E:\\API获取工具\\ZO注册\\node_modules\\puppeteer-core');
(async () => {
  const browser = await puppeteer.connect({ browserURL: 'http://localhost:9222', defaultViewport: null, timeout: 10000 });
  
  // List all targets to find extension service workers
  const targets = browser.targets();
  for (const t of targets) {
    console.log('Target: type=' + t.type() + ' url=' + t.url());
  }
  
  // Try opening the extensions page
  const page = await browser.newPage();
  await page.goto('chrome://extensions', { waitUntil: 'domcontentloaded', timeout: 10000 });
  await new Promise(r => setTimeout(r, 3000));
  
  // Get extension info via the extensions page
  const extInfo = await page.evaluate(() => {
    // Try to get extension manager data
    if (typeof chrome !== 'undefined' && chrome.developerPrivate) {
      return 'has developerPrivate API';
    }
    return 'no developerPrivate API';
  }).catch(() => 'eval failed');
  console.log('Extension info:', extInfo);
  
  await page.screenshot({ path: 'E:\\API获取工具\\ZO注册\\debug_extensions.png' });
  console.log('Screenshot saved');
  
  await page.close();
  browser.disconnect();
})().catch(e => console.error('Error:', e.message));
