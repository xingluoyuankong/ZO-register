// diag_verify3.js — 深度诊断 verify 页面 Turnstile 状态
const { launchBrowser, getMailToken, pollMagicLink } = require('./zo_register');
const fs = require('fs');
const path = require('path');

const ZO_FILE = 'C:\\Users\\XZXyuan\\Downloads\\zo_all.txt';
const AT_DIR = path.join(__dirname, '..', 'registered', 'Access Tokens');

function log(msg) { console.log(msg); }

async function test() {
  const zoLines = fs.readFileSync(ZO_FILE, 'utf8').trim().split('\n');
  const atFiles = fs.existsSync(AT_DIR) ? fs.readdirSync(AT_DIR).map(f => f.replace('.txt', '')) : [];
  
  for (const line of zoLines) {
    const parts = line.split(/----/);
    if (parts.length < 4) continue;
    const email = parts[0].trim();
    if (atFiles.includes(email)) continue;
    
    log('Email: ' + email);
    
    const config = { 
      email, 
      password: parts[1].trim(), 
      clientId: parts[2].trim().replace(/^-/, ''),
      refreshToken: parts[3].trim(),
      browserType: 'edge',
      edgePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      graphTokenUrl: 'https://login.microsoftonline.com/consumers/oauth2/v2.0/token',
      graphMailUrl: 'https://graph.microsoft.com/v1.0/me/messages'
    };
    
    const mailToken = await getMailToken(config.clientId, config.refreshToken, config);
    log('Mail token OK');
    
    const { browser, page, tempDir } = await launchBrowser(config, log);
    
    // 拦截网络请求
    const networkLog = [];
    page.on('request', req => {
      const url = req.url();
      if (/turnstile|challenge|captcha|cloudflare|email-login|api\//.test(url)) {
        networkLog.push('[REQ] ' + req.method() + ' ' + url.substring(0, 200));
      }
    });
    page.on('response', resp => {
      const url = resp.url();
      if (/turnstile|challenge|captcha|cloudflare|email-login|api\//.test(url)) {
        networkLog.push('[RESP] ' + resp.status() + ' ' + url.substring(0, 200));
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
    log('Email sent, polling for magic link...');
    
    const sendTime = new Date();
    const result = await pollMagicLink(email, config.clientId, config.refreshToken, sendTime, log, config);
    const magicLink = result.link;
    log('LINK: ' + magicLink.substring(0, 120));
    
    // Clear network log before verify
    networkLog.length = 0;
    
    // Open magic link
    await page.goto(magicLink, { waitUntil: 'domcontentloaded', timeout: 60000 });
    log('Verify page: ' + page.url());
    
    // Wait 8s for initial load
    await new Promise(r => setTimeout(r, 8000));
    
    // Analysis 1: after 8s
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
    
    log('\n=== ANALYSIS 1 (8s) ===');
    log(JSON.stringify(a1, null, 2));
    log('\n=== NETWORK LOG (so far) ===');
    for (const r of networkLog) log(r);
    
    // Wait 20 more seconds
    await new Promise(r => setTimeout(r, 20000));
    
    // Analysis 2: after 28s
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
    
    log('\n=== ANALYSIS 2 (28s) ===');
    log(JSON.stringify(a2, null, 2));
    log('\n=== FULL NETWORK LOG ===');
    for (const r of networkLog) log(r);
    
    // Try various confirm API formats
    const verifyUrl = page.url();
    const tokenMatch = verifyUrl.match(/token=([^&]+)/);
    if (tokenMatch) {
      log('\n=== TRYING CONFIRM API ===');
      log('Token length: ' + tokenMatch[1].length);
      
      // 1. GET (original)
      const r1 = await page.evaluate(async (token) => {
        try {
          const resp = await fetch('/api/email-login/confirm?token=' + token, { credentials: 'include' });
          return { method: 'GET', status: resp.status, body: (await resp.text()).substring(0, 200) };
        } catch(e) { return { method: 'GET', error: e.message }; }
      }, tokenMatch[1]);
      log('GET: ' + JSON.stringify(r1));
      
      // 2. POST JSON
      const r2 = await page.evaluate(async (token) => {
        try {
          const resp = await fetch('/api/email-login/confirm', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token }), credentials: 'include'
          });
          return { method: 'POST-JSON', status: resp.status, body: (await resp.text()).substring(0, 200) };
        } catch(e) { return { method: 'POST-JSON', error: e.message }; }
      }, tokenMatch[1]);
      log('POST-JSON: ' + JSON.stringify(r2));
      
      // 3. POST text/plain
      const r3 = await page.evaluate(async (token) => {
        try {
          const resp = await fetch('/api/email-login/confirm', {
            method: 'POST', headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
            body: JSON.stringify({ token }), credentials: 'include'
          });
          return { method: 'POST-TEXT', status: resp.status, body: (await resp.text()).substring(0, 200) };
        } catch(e) { return { method: 'POST-TEXT', error: e.message }; }
      }, tokenMatch[1]);
      log('POST-TEXT: ' + JSON.stringify(r3));
      
      // 4. POST raw token
      const r4 = await page.evaluate(async (token) => {
        try {
          const resp = await fetch('/api/email-login/confirm', {
            method: 'POST', headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
            body: token, credentials: 'include'
          });
          return { method: 'POST-RAW', status: resp.status, body: (await resp.text()).substring(0, 200) };
        } catch(e) { return { method: 'POST-RAW', error: e.message }; }
      }, tokenMatch[1]);
      log('POST-RAW: ' + JSON.stringify(r4));
      
      // 5. POST form-urlencoded
      const r5 = await page.evaluate(async (token) => {
        try {
          const resp = await fetch('/api/email-login/confirm', {
            method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: 'token=' + encodeURIComponent(token), credentials: 'include'
          });
          return { method: 'POST-FORM', status: resp.status, body: (await resp.text()).substring(0, 200) };
        } catch(e) { return { method: 'POST-FORM', error: e.message }; }
      }, tokenMatch[1]);
      log('POST-FORM: ' + JSON.stringify(r5));
    }
    
    // Check cookies
    const cookies = await page.cookies();
    log('\n=== COOKIES ===');
    for (const c of cookies) {
      log(c.name + '=' + c.value.substring(0, 50) + ' (domain: ' + c.domain + ')');
    }
    
    // Final URL
    log('\n=== FINAL URL ===');
    log(page.url());
    
    await browser.close();
    log('\nDONE');
    process.exit(0);
  }
}
test().catch(e => { console.error('ERROR:', e.message, e.stack); process.exit(1); });
