const pptr = require('puppeteer-extra');
const Stealth = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
pptr.use(Stealth());

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const content = fs.readFileSync('/home/workspace/extracted_emails/hilljulia5es7y81c6u8a@outlook.com.txt', 'utf-8').trim();
  const [email, , clientId, refreshToken] = content.split('----').map(s => s.trim());

  // Step 1: Get token
  const tr = await fetch('https://login.microsoftonline.com/consumers/oauth2/v2.0/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId, grant_type: 'refresh_token', refresh_token: refreshToken,
      scope: 'https://graph.microsoft.com/.default offline_access',
    }).toString()
  });
  const td = await tr.json();
  if (!td.access_token) { console.log('Token failed'); return; }

  // Step 2: Send email via browser
  const b = await pptr.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });
  const p = await b.newPage();

  await p.goto('https://www.zo.computer/signup', { waitUntil: 'networkidle2', timeout: 30000 });
  await sleep(2000);

  await p.evaluate(() => {
    for (const btn of document.querySelectorAll('button')) {
      if (btn.textContent.includes('Email me a sign-up link')) { btn.click(); return; }
    }
  });
  await sleep(2000);

  await p.evaluate((em) => {
    const inp = document.getElementById('email');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(inp, em);
    inp.dispatchEvent(new Event('input', { bubbles: true }));
  }, email);
  await sleep(500);

  await p.evaluate(() => {
    for (const btn of document.querySelectorAll('button')) {
      if (btn.textContent.trim() === 'Continue') { btn.click(); return; }
    }
  });
  await sleep(3000);

  const st = await p.evaluate(() => document.body.innerText.substring(0, 200));
  console.log('Sent:', st.substring(0, 60));
  if (!/check your email/i.test(st)) {
    console.log('ERROR: submit failed');
    await b.close();
    return;
  }

  // Step 3: Poll for magic link
  console.log('Polling for magic link...');
  let magicLink = null;
  for (let i = 1; i <= 30; i++) {
    const mr = await fetch('https://graph.microsoft.com/v1.0/me/messages?$top=5&$select=subject,body,receivedDateTime&$orderby=receivedDateTime%20desc', {
      headers: { Authorization: 'Bearer ' + td.access_token }
    });
    const mail = await mr.json();
    for (const m of (mail.value || [])) {
      if (Date.now() - new Date(m.receivedDateTime).getTime() > 300000) continue;
      const html = (m.body?.content || '').replace(/&amp;/g, '&');
      const links = html.match(/https:\/\/www\.zo\.computer\/api\/email-login\/verify[^\s"'<>]*/gi);
      if (links && links[0]) {
        magicLink = links[0].replace(/[)>,\s]+$/, '');
        break;
      }
    }
    if (magicLink) { console.log(`Got link at poll #${i}`); break; }
    await sleep(5000);
  }

  if (!magicLink) { console.log('No magic link found'); await b.close(); return; }
  console.log('Link:', magicLink.substring(0, 80) + '...');

  // Step 4: Open magic link
  console.log('Opening magic link...');
  try {
    await p.goto(magicLink, { waitUntil: 'domcontentloaded', timeout: 45000 });
  } catch (e) {
    console.log('Nav error (expected for Turnstile):', e.message.substring(0, 50));
  }
  await sleep(5000);

  // Step 5: Wait for handle page
  console.log('Waiting for handle page...');
  let reachedHandle = false;
  for (let i = 1; i <= 40; i++) {
    const txt = await p.evaluate(() => document.body.innerText.substring(0, 500));
    
    if (/choose your handle/i.test(txt)) {
      console.log(`[${i}] Reached handle page!`);
      reachedHandle = true;
      break;
    }

    // Try clicking "Continue in browser"
    const c = await p.evaluate(() => {
      for (const el of document.querySelectorAll('button, a, span')) {
        if (/continue in browser/i.test(el.textContent.trim()) && el.offsetParent !== null) {
          el.click(); return true;
        }
      }
      return false;
    }).catch(() => false);

    if (c) {
      console.log(`[${i}] Clicked Continue in browser`);
      await sleep(3000);
      continue;
    }

    if (/redirecting/i.test(txt)) { await sleep(5000); continue; }
    if (i % 5 === 0) console.log(`[${i}] Still waiting... Body starts: ${txt.substring(0, 60)}`);
    await sleep(3000);
  }

  if (reachedHandle) {
    console.log('SUCCESS: Reached handle page!');
    await p.screenshot({ path: '/tmp/zo-handle-page.png' });
    
    // Fill handle
    const handle = 'user' + Math.random().toString(36).substring(2, 8);
    console.log(`Setting handle: ${handle}`);
    
    await p.evaluate((h) => {
      const inp = document.querySelector('input[type=text], input:not([type=hidden])');
      if (!inp) return;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(inp, h);
      inp.dispatchEvent(new Event('input', { bubbles: true }));
    }, handle);
    await sleep(1000);

    await p.evaluate(() => {
      for (const btn of document.querySelectorAll('button')) {
        if (btn.textContent.trim() === 'Continue') { btn.click(); return; }
      }
    });
    await sleep(5000);

    // Wait for boot
    console.log('Waiting for boot...');
    for (let i = 1; i <= 60; i++) {
      await sleep(5000);
      const txt = await p.evaluate(() => document.body.innerText.substring(0, 500));
      if (/go to your zo/i.test(txt)) {
        console.log('Boot complete!');
        await p.evaluate(() => {
          for (const el of document.querySelectorAll('button, a, span')) {
            if (/go to your zo/i.test(el.textContent.trim())) { el.click(); return; }
          }
        });
        await sleep(8000);
        console.log('Final URL:', p.url());
        break;
      }
      const pct = txt.match(/(\d+\.?\d*)%/);
      if (pct && i % 2 === 0) console.log(`  Boot: ${pct[1]}%`);
    }
  } else {
    console.log('FAILED: Did not reach handle page');
    await p.screenshot({ path: '/tmp/zo-fail.png' });
  }

  await b.close();
  console.log('DONE');
})();
