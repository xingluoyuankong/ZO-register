const pptr = require('puppeteer-extra');
const Stealth = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
pptr.use(Stealth());

(async () => {
  const content = fs.readFileSync('/home/workspace/extracted_emails/hilljulia5es7y81c6u8a@outlook.com.txt', 'utf-8').trim();
  const [email, , clientId, refreshToken] = content.split('----').map(s => s.trim());
  console.log('Email:', email);

  const b = await pptr.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });
  const p = await b.newPage();
  
  // Monitor network
  let submitResponse = null;
  p.on('response', (r) => {
    if (r.url().includes('/api/email-login')) {
      console.log('API Response:', r.status(), r.url());
      r.text().then(t => {
        console.log('API Body:', t.substring(0, 200));
      });
    }
  });

  await p.goto('https://www.zo.computer/signup', { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 2000));

  // Click "Email me a sign-up link"
  await p.evaluate(() => {
    for (const b of document.querySelectorAll('button')) {
      if (b.textContent.includes('Email me a sign-up link')) { b.click(); return; }
    }
  });
  await new Promise(r => setTimeout(r, 2000));

  // Fill email
  await p.evaluate((em) => {
    const inp = document.getElementById('email');
    if (!inp) return;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(inp, em);
    inp.dispatchEvent(new Event('input', { bubbles: true }));
  }, email);
  await new Promise(r => setTimeout(r, 500));

  // Click Continue
  console.log('Clicking Continue...');
  await p.evaluate(() => {
    for (const b of document.querySelectorAll('button')) {
      if (b.textContent.trim() === 'Continue') { b.click(); return; }
    }
  });
  await new Promise(r => setTimeout(r, 5000));

  const body = await p.evaluate(() => document.body.innerText.substring(0, 300));
  console.log('Page after submit:', body);

  // Save screenshot
  await p.screenshot({ path: '/tmp/zo-test.png', fullPage: true });
  console.log('Screenshot saved');

  // Now poll inbox
  console.log('Polling inbox...');
  for (let i = 1; i <= 24; i++) {
    try {
      const tokenResp = await fetch('https://login.microsoftonline.com/consumers/oauth2/v2.0/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: clientId,
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          scope: 'https://graph.microsoft.com/.default offline_access',
        }).toString()
      });
      const td = await tokenResp.json();
      if (!td.access_token) { console.log('Token failed:', td); break; }

      const resp = await fetch('https://graph.microsoft.com/v1.0/me/messages?$top=15&$select=subject,body,receivedDateTime&$orderby=receivedDateTime%20desc', {
        headers: { Authorization: 'Bearer ' + td.access_token }
      });
      const mail = await resp.json();
      const newMails = (mail.value || []).filter(m => new Date(m.receivedDateTime) > new Date(Date.now() - 300000));
      console.log(`  [${i}] New mails: ${newMails.length}`);
      for (const m of newMails) {
        const html = (m.body?.content || '').replace(/&amp;/g, '&');
        const links = html.match(/https:\/\/www\.zo\.computer\/api\/email-login\/verify[^\s"'<>]*/gi) || [];
        console.log(`    ${m.subject} - links: ${links.length}`);
        if (links.length > 0) console.log('    LINK:', links[0]);
      }
    } catch (e) { console.log(`  [${i}] Error:`, e.message); }
    await new Promise(r => setTimeout(r, 10000));
  }

  await b.close();
  console.log('DONE');
})();
