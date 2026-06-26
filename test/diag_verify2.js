// diag_verify2.js — 深度诊断 verify 页面
const { launchBrowser, getMailToken, pollMagicLink } = require('./zo_register');
const fs = require('fs');
const path = require('path');

// 读取 zo_all.txt
const ZO_FILE = 'C:\\Users\\XZXyuan\\Downloads\\zo_all.txt';
const AT_DIR = path.join(__dirname, '..', 'registered', 'Access Tokens');

async function test() {
  const zoLines = fs.readFileSync(ZO_FILE, 'utf8').trim().split('\n');
  const atFiles = fs.existsSync(AT_DIR) ? fs.readdirSync(AT_DIR).map(f => f.replace('.txt', '')) : [];
  
  for (const line of zoLines) {
    const parts = line.split(/----/);
    if (parts.length < 4) continue;
    const email = parts[0].trim();
    if (atFiles.includes(email)) continue;
    
    console.log('Email:', email);
    
    const config = { 
      email, 
      password: parts[1].trim(), 
      clientId: parts[2].trim().replace(/^-/, ''), // 去掉前导破折号
      refreshToken: parts[3].trim(),
      browserType: 'edge',
      edgePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      graphTokenUrl: 'https://login.microsoftonline.com/consumers/oauth2/v2.0/token',
      graphMailUrl: 'https://graph.microsoft.com/v1.0/me/messages'
    };
    
    const mailToken = await getMailToken(config.clientId, config.refreshToken, config);
    console.log('Mail token OK');
    
    const { browser, page, tempDir } = await launchBrowser(config, (msg) => console.log(msg));
    
    // 拦截网络请求
    const requests = [];
    page.on('request', req => {
      const url = req.url();
      if (/turnstile|challenge|captcha|cloudflare|email-login|api\//.test(url)) {
        requests.push({ method: req.method(), url: url.substring(0, 200), type: req.resourceType() });
      }
    });
    page.on('response', resp => {
      const url = resp.url();
      if (/turnstile|challenge|captcha|cloudflare|email-login|api\//.test(url)) {
        requests.push({ type: 'RESPONSE', status: resp.status(), url: url.substring(0, 200) });
      }
    });
    
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
    console.log('Email sent, polling for magic link...');
    
    const link = await pollMagicLink(mailToken.accessToken, email, (msg) => console.log(msg), config);
    console.log('LINK:', link.substring(0, 120));
    
    // Clear requests before verify
    requests.length = 0;
    
    // Open magic link
    await page.goto(link, { waitUntil: 'domcontentloaded', timeout: 60000 });
    console.log('Verify page:', page.url());
    
    // Wait 8s for initial load
    await new Promise(r => setTimeout(r, 8000));
    
    // Analysis 1
    const a1 = await page.evaluate(() => {
      const r = {};
      r.url = location.href;
      r.bodyText = document.body.innerText.substring(0, 400);
      r.turnstileExists = typeof turnstile !== 'undefined';
      if (r.turnstileExists) {
        r.turnstileMethods = Object.keys(turnstile);
        try { r.turnstileResponse = turnstile.getResponse(); } catch(e) { r.getResponseErr = e.message; }
      }
      r.iframes = [];
      for (const iframe of document.querySelectorAll('iframe')) {
        const rect = iframe.getBoundingClientRect();
        r.iframes.push({ src: iframe.src.substring(0, 200), w: rect.width, h: rect.height, visible: rect.width > 0 && rect.height > 0 });
      }
      r.containers = [];
      for (const c of document.querySelectorAll('.cf-turnstile, [data-sitekey]')) {
        r.containers.push({ tag: c.tagName, sitekey: c.getAttribute('data-sitekey'), class: c.className });
      }
      r.hiddenInputs = [];
      for (const inp of document.querySelectorAll('input[name*=turnstile], input[name*=cf-], input[type=hidden]')) {
        r.hiddenInputs.push({ name: inp.name, val: inp.value.substring(0, 80) });
      }
      r.scripts = [];
      for (const s of document.querySelectorAll('script[src*=turnstile], script[src*=challenges]')) {
        r.scripts.push({ src: s.src.substring(0, 200) });
      }
      r.perfEntries = performance.getEntriesByType('resource').filter(e => /turnstile|challenge|captcha/.test(e.name)).map(e => e.name.substring(0, 150));
      return r;
    }).catch(e => ({ error: e.message }));
    
    console.log('\n=== ANALYSIS 1 (8s) ===');
    console.log(JSON.stringify(a1, null, 2));
    console.log('\n=== NETWORK REQUESTS (so far) ===');
    for (const r of requests) {
      console.log(JSON.stringify(r));
    }
    
    // Wait 20 more seconds
    await new Promise(r => setTimeout(r, 20000));
    
    // Analysis 2
    const a2 = await page.evaluate(() => {
      const r = {};
      r.url = location.href;
      r.bodyText = document.body.innerText.substring(0, 400);
      r.turnstileExists = typeof turnstile !== 'undefined';
      if (r.turnstileExists) {
        try { r.turnstileResponse = turnstile.getResponse(); } catch(e) {}
      }
      r.hiddenInputs = [];
      for (const inp of document.querySelectorAll('input[name*=turnstile], input[name*=cf-]')) {
        r.hiddenInputs.push({ name: inp.name, val: inp.value.substring(0, 80) });
      }
      return r;
    }).catch(e => ({ error: e.message }));
    
    console.log('\n=== ANALYSIS 2 (28s) ===');
    console.log(JSON.stringify(a2, null, 2));
    console.log('\n=== ALL NETWORK REQUESTS ===');
    for (const r of requests) {
      console.log(JSON.stringify(r));
    }
    
    // Try POST confirm with correct format
    const tokenMatch = page.url().match(/token=([^&]+)/);
    if (tokenMatch) {
      console.log('\n=== TRYING POST CONFIRM ===');
      const postResult = await page.evaluate(async (token) => {
        try {
          const resp = await fetch('/api/email-login/confirm', {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
            body: JSON.stringify({ token }),
            credentials: 'include',
          });
          const text = await resp.text();
          return { status: resp.status, ok: resp.ok, body: text.substring(0, 200) };
        } catch(e) {
          return { error: e.message };
        }
      }, tokenMatch[1]);
      console.log('POST result:', JSON.stringify(postResult, null, 2));
      
      // Also try with application/json
      const postResult2 = await page.evaluate(async (token) => {
        try {
          const resp = await fetch('/api/email-login/confirm', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token }),
            credentials: 'include',
          });
          const text = await resp.text();
          return { status: resp.status, ok: resp.ok, body: text.substring(0, 200) };
        } catch(e) {
          return { error: e.message };
        }
      }, tokenMatch[1]);
      console.log('POST (json) result:', JSON.stringify(postResult2, null, 2));
      
      // Try raw token
      const postResult3 = await page.evaluate(async (token) => {
        try {
          const resp = await fetch('/api/email-login/confirm', {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
            body: token,
            credentials: 'include',
          });
          const text = await resp.text();
          return { status: resp.status, ok: resp.ok, body: text.substring(0, 200) };
        } catch(e) {
          return { error: e.message };
        }
      }, tokenMatch[1]);
      console.log('POST (raw token) result:', JSON.stringify(postResult3, null, 2));
    }
    
    // Check cookies
    const cookies = await page.cookies();
    console.log('\n=== COOKIES ===');
    for (const c of cookies) {
      console.log(c.name + '=' + c.value.substring(0, 50) + ' (domain: ' + c.domain + ')');
    }
    
    await browser.close();
    console.log('\nDONE');
    process.exit(0);
  }
}
test().catch(e => { console.error('ERROR:', e.message, e.stack); process.exit(1); });
