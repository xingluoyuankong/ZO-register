const pptr = require('puppeteer-extra');
const Stealth = require('puppeteer-extra-plugin-stealth');
const { readFileSync, existsSync, mkdirSync, appendFileSync } = require('fs');
const { join } = require('path');
pptr.use(Stealth());

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const EMAIL_DIR = '/home/workspace/extracted_emails';
  const REG_DIR = '/home/workspace/ZO-register/registered';
  mkdirSync(REG_DIR, { recursive: true });

  // Pick one account
  const file = 'amelida35vsrxp601u61w9@outlook.com.txt';
  const content = readFileSync(join(EMAIL_DIR, file), 'utf-8').trim();
  const [email, password, clientId, refreshToken] = content.split('----').map(s => s.trim());

  console.log('Email:', email);
  console.log('ClientID:', clientId.substring(0, 12) + '...');

  const browser = await pptr.launch({
    headless: false,
    args: [
      '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled',
      '--user-agent=Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      '--window-size=1440,900'
    ]
  });
  const page = await browser.newPage();
  await page.setDefaultTimeout(30000);

  // Phase 1: Send email
  console.log('\n=== Phase 1: Send email ===');
  await page.goto('https://www.zo.computer/signup', { waitUntil: 'networkidle2', timeout: 30000 });
  await sleep(2000);

  await page.evaluate(() => {
    for (const b of document.querySelectorAll('button')) {
      if (/Email me a sign-up link/i.test(b.textContent)) { b.click(); return; }
    }
  });
  await sleep(2000);

  await page.evaluate((em) => {
    const inp = document.getElementById('email') || document.querySelector('input[type=email]');
    if (!inp) return;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(inp, em);
    inp.dispatchEvent(new Event('input', { bubbles: true }));
  }, email);
  await sleep(500);

  await page.evaluate(() => {
    for (const b of document.querySelectorAll('button')) {
      if (b.textContent.trim() === 'Continue' && b.offsetParent !== null) { b.click(); return; }
    }
  });
  await sleep(3000);

  let txt = await page.evaluate(() => document.body.innerText.substring(0, 300));
  console.log('Page:', txt);
  if (!/check your email/i.test(txt)) { console.log('FAIL: email not sent'); process.exit(1); }
  const sendTime = new Date(Date.now() - 10000);

  // Poll for magic link
  console.log('Polling...');
  let magicLink = null;
  for (let i = 0; i < 36; i++) {
    const body = new URLSearchParams({
      client_id: clientId, grant_type: 'refresh_token', refresh_token: refreshToken,
      scope: 'https://graph.microsoft.com/.default offline_access',
    });
    const resp = await fetch('https://login.microsoftonline.com/consumers/oauth2/v2.0/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString(),
    });
    const tok = await resp.json();
    if (tok.error) { process.stdout.write('x'); await sleep(5000); continue; }

    const murl = 'https://graph.microsoft.com/v1.0/me/messages?$top=10&$select=subject,body,receivedDateTime&$orderby=receivedDateTime%20desc';
    const mresp = await fetch(murl, { headers: { Authorization: 'Bearer ' + tok.access_token } });
    const mdata = await mresp.json();

    for (const msg of (mdata.value || [])) {
      if (new Date(msg.receivedDateTime) < sendTime) continue;
      const html = (msg.body?.content || '').replace(/&amp;/g, '&');
      if (!/zo[ .-]*computer/i.test(msg.subject + ' ' + html)) continue;
      const links = html.match(/https:\/\/www\.zo\.computer\/api\/email-login\/verify\?[^\s"'<>\[\]]+/gi) || [];
      if (links[0]) { magicLink = links[0].replace(/[)>,\s]+$/, ''); break; }
    }
    if (magicLink) { console.log('\nGot link at poll #' + (i + 1)); break; }
    process.stdout.write('.');
    await sleep(5000);
  }

  if (!magicLink) { console.log('\nFAIL: no magic link'); process.exit(1); }
  console.log('Link:', magicLink.substring(0, 80) + '...');

  // Phase 2: Open magic link
  console.log('\n=== Phase 2: Open magic link ===');
  await page.goto(magicLink, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(5000);

  console.log('Waiting for Turnstile + handle page...');
  let reachedHandle = false;
  for (let i = 1; i <= 60; i++) {
    txt = await page.evaluate(() => document.body.innerText.substring(0, 600));

    if (/choose your handle/i.test(txt)) {
      console.log(`Handle page reached at ${i*5}s!`);
      reachedHandle = true;
      break;
    }

    if (/invalid|expired/i.test(txt) && !/redirecting|verif|check/i.test(txt)) {
      console.log('LINK INVALID/EXPIRED. Page:', txt.substring(0, 200));
      await page.screenshot({ path: join(REG_DIR, 'expired.png') });
      process.exit(1);
    }

    const c = await page.evaluate(() => {
      for (const el of document.querySelectorAll('button, a, span, div[role=button]')) {
        if (/continue in browser/i.test(el.textContent.trim()) && el.offsetParent !== null) {
          el.click(); return true;
        }
      }
      return false;
    }).catch(() => false);

    if (c) {
      console.log(`  Clicked Continue in browser (${i})`);
      try { await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 20000 }); } catch(e) {}
      await sleep(3000);
      const u = page.url();
      console.log('  URL:', u);
      continue;
    }

    if (i % 5 === 0) console.log(`  [${i*5}s] ${txt.substring(0, 80)}`);
    await sleep(5000);
  }

  if (!reachedHandle) {
    await page.screenshot({ path: join(REG_DIR, 'no_handle.png') });
    console.log('FAIL: no handle page');
    process.exit(1);
  }

  // Set handle
  const handle = 'test' + Math.random().toString(36).substring(2, 7);
  console.log('Handle:', handle);
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

  // Boot
  console.log('Booting...');
  for (let i = 1; i <= 60; i++) {
    await sleep(5000);
    txt = await page.evaluate(() => document.body.innerText.substring(0, 500));
    if (/go to your zo/i.test(txt)) {
      console.log('Boot complete!');
      await page.evaluate(() => {
        for (const el of document.querySelectorAll('button, a, span')) {
          if (/go to your zo/i.test(el.textContent.trim())) { el.click(); return; }
        }
      });
      await sleep(8000);
      const fin = page.url();
      console.log('SUCCESS!', fin);
      appendFileSync(join(REG_DIR, 'results.jsonl'), JSON.stringify({ email, handle, zoAddress: handle+'.zo.computer', time: new Date().toISOString(), status: 'success' }) + '\n');
      break;
    }
    const pct = txt.match(/(\d+\.?\d*)%/);
    if (pct && i % 2 === 0) console.log('  Boot:', pct[1] + '%');
  }

  await browser.close();
  console.log('DONE');
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
