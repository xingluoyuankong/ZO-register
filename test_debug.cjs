// Debug: Open a magic link and take screenshots at each step
const puppeteer = require('E:\\API获取工具\\ZO注册\\node_modules\\puppeteer-core');

(async () => {
  const browser = await puppeteer.connect({ browserURL: 'http://localhost:9222', defaultViewport: null, timeout: 10000 });
  const pages = await browser.pages();
  const page = pages[pages.length - 1];
  
  console.log('Current URL:', page.url());
  
  // Take screenshot of current state
  await page.screenshot({ path: 'E:\\API获取工具\\ZO注册\\debug_step1.png', fullPage: true });
  console.log('Screenshot 1 saved');
  
  // Get all elements with their visibility
  const elements = await page.evaluate(() => {
    const result = [];
    const allElements = document.querySelectorAll('*');
    for (const el of allElements) {
      if (el.children.length === 0 && el.textContent.trim()) {
        const style = window.getComputedStyle(el);
        result.push({
          tag: el.tagName,
          text: el.textContent.trim().substring(0, 100),
          visible: style.display !== 'none' && style.visibility !== 'hidden' && el.offsetParent !== null,
          id: el.id || '',
          class: el.className || '',
        });
      }
    }
    return result.filter(e => e.visible && e.text.length > 2).slice(0, 30);
  });
  
  console.log('\nVisible elements:');
  for (const el of elements) {
    console.log('  [' + el.tag + '] ' + el.text);
  }
  
  // Check for Turnstile iframe
  const iframes = await page.evaluate(() => {
    const frames = document.querySelectorAll('iframe');
    return Array.from(frames).map(f => ({
      src: f.src,
      visible: f.offsetParent !== null,
      width: f.offsetWidth,
      height: f.offsetHeight,
    }));
  });
  console.log('\nIframes:', JSON.stringify(iframes, null, 2));
  
  // Check turnstile widget
  const turnstileInfo = await page.evaluate(() => {
    const result = {};
    try {
      result.turnstileExists = typeof turnstile !== 'undefined';
      if (result.turnstileExists) {
        result.getResponse = turnstile.getResponse() ? 'has response' : 'no response';
      }
    } catch(e) { result.error = e.message; }
    
    const widget = document.querySelector('[data-sitekey]');
    result.widgetFound = !!widget;
    if (widget) {
      result.sitekey = widget.getAttribute('data-sitekey');
      result.widgetHTML = widget.outerHTML.substring(0, 200);
    }
    
    const cfInput = document.querySelector('input[name="cf-turnstile-response"]');
    result.cfInputFound = !!cfInput;
    if (cfInput) result.cfInputValue = cfInput.value ? cfInput.value.substring(0, 50) + '...' : 'empty';
    
    return result;
  });
  console.log('\nTurnstile info:', JSON.stringify(turnstileInfo, null, 2));
  
  browser.disconnect();
})().catch(e => console.error('Error:', e.message));
