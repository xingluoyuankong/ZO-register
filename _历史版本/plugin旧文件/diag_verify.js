// diag_verify.js — 深度诊断 verify 页面 Turnstile 状态
const { launchBrowser, getMailToken, pollMagicLink } = require('./zo_register');
const fs = require('fs');

async function test() {
  const zoLines = fs.readFileSync('zo.txt', 'utf8').trim().split('\n').slice(1);
  const atDir = '../registered/Access Tokens';
  const atFiles = fs.existsSync(atDir) ? fs.readdirSync(atDir).map(f => f.replace('.txt', '')) : [];
  
  for (const line of zoLines) {
    const parts = line.split(/----/);
    if (parts.length < 4) continue;
    const email = parts[0].trim();
    if (atFiles.includes(email)) continue;
    
    const log = (msg) => { console.log(msg); };
    log('Email: ' + email);
    
    const config = { email, password: parts[1].trim(), clientId: parts[2].trim(), refreshToken: parts[3].trim() };
    const mailToken = await getMailToken(config);
    log('Mail token OK');
    
    const browser = await launchBrowser({ headless: false, turnstileExtDir: '../turnstile-extension' });
    const page = (await browser.pages())[0] || await browser.newPage();
    
    await page.goto('https://www.zo.computer/signup', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await new Promise(r => setTimeout(r, 3000));
    
    // Click email button
    const btns = await page.$$('button, a');
    for (const btn of btns) {
      const txt = await btn.evaluate(el => el.textContent);
      if (/Email me a sign-up link/i.test(txt)) { await btn.click(); break; }
    }
    await new Promise(r => setTimeout(r, 2000));
    
    // Fill email
    const emailInput = await page.$('input[type=email], input[type=text]');
    if (emailInput) {
      await emailInput.click({ clickCount: 3 });
      await page.keyboard.type(email, { delay: 50 });
    }
    
    // Click Continue
    const continueBtns = await page.$$('button');
    for (const btn of continueBtns) {
      const txt = await btn.evaluate(el => el.textContent);
      if (/^Continue$/i.test(txt)) { await btn.click(); break; }
    }
    await new Promise(r => setTimeout(r, 3000));
    log('Email sent, polling for magic link...');
    
    const link = await pollMagicLink(mailToken, email, (msg) => log(msg));
    log('LINK: ' + link.substring(0, 100));
    
    // Open magic link
    await page.goto(link, { waitUntil: 'domcontentloaded', timeout: 60000 });
    log('Verify page opened: ' + page.url());
    await new Promise(r => setTimeout(r, 8000));
    
    // Analysis 1: after 8s
    const a1 = await page.evaluate(() => {
      const r = {};
      r.url = location.href;
      r.bodyText = document.body.innerText.substring(0, 300);
      r.turnstileExists = typeof turnstile !== 'undefined';
      if (r.turnstileExists) {
        r.turnstileMethods = Object.keys(turnstile);
        try { r.turnstileResponse = turnstile.getResponse(); } catch(e) { r.getResponseErr = e.message; }
      }
      const iframes = document.querySelectorAll('iframe');
      r.iframes = [];
      for (const iframe of iframes) {
        const rect = iframe.getBoundingClientRect();
        r.iframes.push({ src: iframe.src.substring(0, 150), w: rect.width, h: rect.height, visible: rect.width > 0 && rect.height > 0 });
      }
      r.containers = [];
      for (const c of document.querySelectorAll('.cf-turnstile, [data-sitekey]')) {
        r.containers.push({ tag: c.tagName, sitekey: c.getAttribute('data-sitekey') });
      }
      r.hiddenInputs = [];
      for (const inp of document.querySelectorAll('input[name*=turnstile], input[name*=cf-]')) {
        r.hiddenInputs.push({ name: inp.name, val: inp.value.substring(0, 60) });
      }
      r.scripts = [];
      for (const s of document.querySelectorAll('script[src*=turnstile], script[src*=challenges]')) {
        r.scripts.push({ src: s.src.substring(0, 150) });
      }
      r.perfEntries = performance.getEntriesByType('resource').filter(e => /turnstile|challenge|captcha/.test(e.name)).map(e => e.name.substring(0, 120));
      return r;
    }).catch(e => ({ error: e.message }));
    
    log('=== ANALYSIS 1 (8s) ===');
    log(JSON.stringify(a1, null, 2));
    
    // Wait 20 more seconds
    await new Promise(r => setTimeout(r, 20000));
    
    // Analysis 2: after 28s
    const a2 = await page.evaluate(() => {
      const r = {};
      r.url = location.href;
      r.bodyText = document.body.innerText.substring(0, 300);
      r.turnstileExists = typeof turnstile !== 'undefined';
      if (r.turnstileExists) {
        try { r.turnstileResponse = turnstile.getResponse(); } catch(e) {}
      }
      r.hiddenInputs = [];
      for (const inp of document.querySelectorAll('input[name*=turnstile], input[name*=cf-]')) {
        r.hiddenInputs.push({ name: inp.name, val: inp.value.substring(0, 60) });
      }
      r.perfEntries = performance.getEntriesByType('resource').filter(e => /turnstile|challenge|captcha/.test(e.name)).map(e => e.name.substring(0, 120));
      return r;
    }).catch(e => ({ error: e.message }));
    
    log('=== ANALYSIS 2 (28s) ===');
    log(JSON.stringify(a2, null, 2));
    
    // Try calling turnstile.execute() manually
    const execResult = await page.evaluate(() => {
      try {
        if (typeof turnstile === 'undefined') return { error: 'turnstile undefined' };
        const methods = Object.keys(turnstile);
        // Try execute
        if (turnstile.execute) {
          // Get widget container
          const container = document.querySelector('.cf-turnstile, [data-sitekey]');
          if (container) {
            const widgetId = container.getAttribute('data-turnstile-id') || '0';
            return { executeResult: turnstile.execute(widgetId) };
          }
          return { executeCalled: 'no container found', methods };
        }
        return { noExecute: true, methods };
      } catch(e) { return { error: e.message }; }
    }).catch(e => ({ error: e.message }));
    log('=== EXECUTE RESULT ===');
    log(JSON.stringify(execResult, null, 2));
    
    // Wait another 10s
    await new Promise(r => setTimeout(r, 10000));
    log('=== FINAL URL (38s) ===');
    log(page.url());
    log('=== FINAL BODY ===');
    const finalBody = await page.evaluate(() => document.body.innerText.substring(0, 300)).catch(() => '');
    log(finalBody.replace(/\n/g, ' | '));
    
    await browser.close();
    log('DONE');
    process.exit(0);
  }
}
test().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
