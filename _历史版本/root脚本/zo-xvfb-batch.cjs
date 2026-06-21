/**
 * ZO批量注册 - Xvfb版
 * 用虚拟显示器绕过 Turnstile
 */
const pptr = require('puppeteer-extra');
const Stealth = require('puppeteer-extra-plugin-stealth');
pptr.use(Stealth());

const { readFileSync, appendFileSync, readdirSync, writeFileSync, existsSync, mkdirSync, renameSync } = require('fs');
const { join } = require('path');

const EMAIL_DIR = '/home/workspace/extracted_emails';
const REG_DIR = '/home/workspace/ZO-register/registered';
const RESULT_FILE = join(REG_DIR, 'results.jsonl');
const LOG_FILE = join(REG_DIR, 'full.log');

function log(msg) {
  const ts = new Date().toISOString().replace('T',' ').substring(0, 19);
  const line = '[' + ts + '] ' + msg;
  console.log(line);
  appendFileSync(LOG_FILE, line + '\n');
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ====== Graph API ======
async function getMailToken(clientId, refreshToken) {
  const body = new URLSearchParams({
    client_id: clientId, grant_type: 'refresh_token', refresh_token: refreshToken,
    scope: 'https://graph.microsoft.com/.default offline_access',
  });
  const resp = await fetch('https://login.microsoftonline.com/consumers/oauth2/v2.0/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString(),
  });
  const data = await resp.json();
  if (data.error) throw new Error('Token: ' + (data.error_description || JSON.stringify(data.error)));
  return { accessToken: data.access_token, newRefreshToken: data.refresh_token || refreshToken };
}

async function findMagicLink(accessToken, afterTime) {
  const url = 'https://graph.microsoft.com/v1.0/me/messages?$top=15&$select=subject,body,receivedDateTime&$orderby=receivedDateTime%20desc';
  const resp = await fetch(url, { headers: { Authorization: 'Bearer ' + accessToken } });
  const data = await resp.json();
  for (const msg of (data.value || [])) {
    if (new Date(msg.receivedDateTime) < afterTime) continue;
    const html = (msg.body?.content || '').replace(/&amp;/g, '&');
    const combined = (msg.subject || '') + ' ' + html;
    if (!/zo[ .-]*computer/i.test(combined)) continue;
    const links = combined.match(/https:\/\/www\.zo\.computer\/api\/email-login\/verify\?[^\s"'<>\[\]]+/gi) || [];
    if (links[0]) return links[0].replace(/[)>,\s]+$/, '');
  }
  return null;
}

async function pollMagicLink(clientId, refreshToken, afterTime, maxWaitMs) {
  let rt = refreshToken;
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    try {
      const { accessToken, newRefreshToken } = await getMailToken(clientId, rt);
      rt = newRefreshToken;
      const link = await findMagicLink(accessToken, afterTime);
      if (link) return { link, newRefreshToken: rt };
    } catch (e) {}
    process.stdout.write('.');
    await sleep(5000);
  }
  return null;
}

// ====== 注册阶段1: 获取魔法链接 ======
async function getMagicLink(browser, email, clientId, refreshToken) {
  const page = await browser.newPage();
  // ★ 注入 Turnstile 绕过补丁
  await page.evaluateOnNewDocument(() => {
    if (window.__TURNSTILE_PATCHED__) return;
    window.__TURNSTILE_PATCHED__ = true;
    var _offX = Math.floor(Math.random() * 121) + 80;
    var _offY = Math.floor(Math.random() * 91) + 60;
    try { Object.defineProperty(MouseEvent.prototype, 'screenX', { get: function() { return (this.clientX||0) + _offX; }, configurable: true }); } catch(e) {}
    try { Object.defineProperty(MouseEvent.prototype, 'screenY', { get: function() { return (this.clientY||0) + _offY; }, configurable: true }); } catch(e) {}
    try { Object.defineProperty(PointerEvent.prototype, 'screenX', { get: function() { return (this.clientX||0) + _offX; }, configurable: true }); } catch(e) {}
    try { Object.defineProperty(PointerEvent.prototype, 'screenY', { get: function() { return (this.clientY||0) + _offY; }, configurable: true }); } catch(e) {}
  });
  try {
    await page.goto('https://www.zo.computer/signup', { waitUntil: 'networkidle2', timeout: 30000 });
    await sleep(2000);

    // Click Email button
    await page.evaluate(() => {
      for (const b of document.querySelectorAll('button')) {
        if (/Email me a sign-up link/i.test(b.textContent)) { b.click(); return; }
      }
    });
    await sleep(2000);

    // Fill email
    await page.evaluate((em) => {
      const inp = document.getElementById('email') || document.querySelector('input[type=email]');
      if (!inp) return;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(inp, em);
      inp.dispatchEvent(new Event('input', { bubbles: true }));
    }, email);
    await sleep(500);

    // Click Continue
    await page.evaluate(() => {
      for (const b of document.querySelectorAll('button')) {
        if (b.textContent.trim() === 'Continue' && b.offsetParent !== null) { b.click(); return; }
      }
    });
    await sleep(3000);

    const txt = await page.evaluate(() => document.body.innerText.substring(0, 300));
    if (!/check your email/i.test(txt)) {
      log('  ⚠ Submit unexpected: ' + txt.substring(0, 60));
      return null;
    }

    const sendTime = new Date(Date.now() - 10000); // 10s buffer
    log('  Email sent, polling inbox...');
    
    const result = await pollMagicLink(clientId, refreshToken, sendTime, 180000);
    if (result) {
      console.log('');
      log('  ✅ Magic link received');
      return result;
    }
    log('  ❌ No magic link within 3min');
    return null;
  } finally {
    await page.close();
  }
}

// ====== 注册阶段2: 打开链接完成注册 ======
async function completeRegistration(page, magicLink, email) {
  log('  Opening magic link...');
  try {
    await page.goto(magicLink, { waitUntil: 'domcontentloaded', timeout: 60000 });
  } catch (e) {
    log('  Nav: ' + (e.message || '').substring(0, 50));
  }
  await sleep(5000);

  // Wait for Turnstile + handle page
  let reachedHandle = false;
  for (let i = 1; i <= 60; i++) {
    const txt = await page.evaluate(() => document.body.innerText.substring(0, 600));

    if (/choose your handle/i.test(txt)) {
      log(`  ✅ Handle page (${i*5}s)`);
      reachedHandle = true;
      break;
    }

    if (/invalid|expired/i.test(txt) && !/redirecting|verif|check/i.test(txt)) {
      log('  ❌ Link expired/invalid');
      await page.screenshot({ path: join(REG_DIR, 'fail_' + Date.now() + '.png') });
      return null;
    }

    // ★ 主动通过 turnstile API 获取令牌
    if (/verifying|browser check|turnstile/i.test(txt) || i >= 3) {
      const tsResult = await page.evaluate(() => {
        try {
          if (typeof turnstile !== 'undefined') {
            const res = turnstile.getResponse();
            if (res) {
              const input = document.querySelector('input[name="cf-turnstile-response"]');
              if (input) {
                const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
                setter.call(input, res);
                input.dispatchEvent(new Event('change', { bubbles: true }));
              }
              return { ok: true, tokenLen: res.length };
            }
            try { turnstile.reset(); } catch(e) {}
          }
        } catch(e) {}
        try {
          const input = document.querySelector('input[name="cf-turnstile-response"]');
          if (input && input.value) return { ok: true, tokenLen: input.value.length };
        } catch(e) {}
        return { ok: false };
      }).catch(() => ({ ok: false }));

      if (tsResult.ok) {
        log('  [Turnstile] Token obtained! len=' + tsResult.tokenLen);
      }
    }

    // Click Continue in browser
    const c = await page.evaluate(() => {
      for (const el of document.querySelectorAll('button, a, span, div[role=button]')) {
        if (/continue in browser/i.test(el.textContent.trim()) && el.offsetParent !== null) {
          el.click(); return true;
        }
      }
      return false;
    }).catch(() => false);

    if (c) {
      log(`  Clicked Continue (${i})`);
      try { await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 20000 }); } catch(e) {}
      await sleep(3000);
      continue;
    }

    if (/redirecting/i.test(txt)) { await sleep(5000); continue; }
    if (i % 6 === 0) log(`  Waiting... [${i*5}s] ${txt.substring(0, 60)}`);
    await sleep(5000);
  }

  if (!reachedHandle) {
    await page.screenshot({ path: join(REG_DIR, 'no_handle_' + Date.now() + '.png') });
    return null;
  }

  // Set handle
  const handle = 'user' + Math.random().toString(36).substring(2, 9);
  log('  Handle: ' + handle);

  await page.evaluate((h) => {
    const inp = document.querySelector('input[type=text]') || document.querySelector('input:not([type=hidden]):not([type=submit])');
    if (!inp) return;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(inp, h);
    inp.dispatchEvent(new Event('input', { bubbles: true }));
  }, handle);
  await sleep(1000);

  await page.evaluate(() => {
    for (const b of document.querySelectorAll('button')) {
      if (/^Continue$/i.test(b.textContent.trim()) && b.offsetParent !== null) { b.click(); return; }
    }
  });
  await sleep(5000);

  // Wait boot
  log('  Booting...');
  for (let i = 1; i <= 60; i++) {
    await sleep(5000);
    const txt = await page.evaluate(() => document.body.innerText.substring(0, 500));

    if (/go to your zo/i.test(txt)) {
      log('  Boot done!');
      await page.evaluate(() => {
        for (const el of document.querySelectorAll('button, a, span')) {
          if (/go to your zo/i.test(el.textContent.trim())) { el.click(); return; }
        }
      });
      await sleep(8000);
      const finalUrl = page.url();
      log('  🎉 SUCCESS! ' + handle + '.zo.computer');

      const rec = { email, handle, zoAddress: handle + '.zo.computer', url: finalUrl, time: new Date().toISOString(), status: 'success' };
      appendFileSync(RESULT_FILE, JSON.stringify(rec) + '\n');

      // Move file to registered
      try {
        const src = join(EMAIL_DIR, email + '.txt');
        if (existsSync(src)) renameSync(src, join(REG_DIR, email + '.txt'));
      } catch (e) {}

      return { success: true, handle, email };
    }

    if (/invalid|expired|something went wrong/i.test(txt) && !/booting|starting|%/i.test(txt)) {
      log('  Boot failed: ' + txt.substring(0, 80));
      return null;
    }

    const pct = txt.match(/(\d+\.?\d*)%/);
    if (pct && i % 3 === 0) log('  Boot: ' + pct[1] + '%');
  }
  log('  Boot timeout');
  return null;
}

// ====== 主流程 ======
async function main() {
  mkdirSync(REG_DIR, { recursive: true });

  // Scan accounts
  const files = readdirSync(EMAIL_DIR).filter(f => {
    if (!f.endsWith('.txt')) return false;
    const c = readFileSync(join(EMAIL_DIR, f), 'utf-8').trim();
    const parts = c.split('----').map(s => s.trim());
    return parts.length >= 4 && parts[2].length > 10 && parts[3].length > 10;
  });

  log(`=== ZO Batch Register (Xvfb) ===`);
  log(`Accounts: ${files.length}`);

  // Launch browser with Xvfb
  log('Launching browser...');
  const browser = await pptr.launch({
    headless: false,
    args: [
      '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled',
      '--user-agent=Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      '--window-size=1440,900'
    ]
  });

  let success = 0, fail = 0;

  for (let idx = 0; idx < files.length; idx++) {
    const file = files[idx];
    const content = readFileSync(join(EMAIL_DIR, file), 'utf-8').trim();
    const [email, password, clientId, refreshToken] = content.split('----').map(s => s.trim());

    log(`\n── [${idx+1}/${files.length}] ${email} ──`);

    try {
      // Phase 1: Get magic link
      const mlResult = await getMagicLink(browser, email, clientId, refreshToken);
      if (!mlResult) { fail++; continue; }

      // Phase 2: Complete registration
      const regPage = await browser.newPage();
      // ★ 注入 Turnstile 绕过补丁
      await regPage.evaluateOnNewDocument(() => {
        if (window.__TURNSTILE_PATCHED__) return;
        window.__TURNSTILE_PATCHED__ = true;
        var _offX = Math.floor(Math.random() * 121) + 80;
        var _offY = Math.floor(Math.random() * 91) + 60;
        try { Object.defineProperty(MouseEvent.prototype, 'screenX', { get: function() { return (this.clientX||0) + _offX; }, configurable: true }); } catch(e) {}
        try { Object.defineProperty(MouseEvent.prototype, 'screenY', { get: function() { return (this.clientY||0) + _offY; }, configurable: true }); } catch(e) {}
        try { Object.defineProperty(PointerEvent.prototype, 'screenX', { get: function() { return (this.clientX||0) + _offX; }, configurable: true }); } catch(e) {}
        try { Object.defineProperty(PointerEvent.prototype, 'screenY', { get: function() { return (this.clientY||0) + _offY; }, configurable: true }); } catch(e) {}
      });
      try {
        const result = await completeRegistration(regPage, mlResult.link, email);
        if (result && result.success) success++; else fail++;
      } finally {
        await regPage.close();
        // Refresh browser page for next account
        for (const p of await browser.pages()) {
          if (p !== regPage) { await p.goto('about:blank'); break; }
        }
      }
    } catch (e) {
      log('  ❌ ' + e.message);
      appendFileSync(RESULT_FILE, JSON.stringify({ email, status: 'fail', error: e.message, time: new Date().toISOString() }) + '\n');
      fail++;
    }

    log(`  📊 ${success} ok / ${fail} fail`);
    await sleep(3000);
  }

  await browser.close();
  log(`\n=== DONE: ${success} success, ${fail} fail ===`);
}

main().catch(e => {
  log('[FATAL] ' + e.message);
  console.error(e);
  process.exit(1);
});
