const pptr = require('puppeteer-extra');
const Stealth = require('puppeteer-extra-plugin-stealth');
pptr.use(Stealth());

(async () => {
  const b = await pptr.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });
  const p = await b.newPage();
  await p.goto('https://www.zo.computer/signup', { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 3000));
  
  const btns = await p.evaluate(() => {
    return Array.from(document.querySelectorAll('button')).map(b => ({
      text: b.textContent.trim().substring(0, 50),
      visible: b.offsetParent !== null,
      className: b.className.substring(0, 60)
    }));
  });
  console.log('Buttons:', JSON.stringify(btns, null, 2));
  
  // Click email signup
  await p.evaluate(() => {
    for (const b of document.querySelectorAll('button')) {
      if (b.textContent.includes('Email me a sign-up link')) { b.click(); return; }
    }
  });
  await new Promise(r => setTimeout(r, 2000));
  
  const inputs = await p.evaluate(() => {
    return Array.from(document.querySelectorAll('input')).map(i => ({
      type: i.type, id: i.id, placeholder: i.placeholder
    }));
  });
  console.log('Inputs after click:', JSON.stringify(inputs));
  
  await b.close();
  console.log('DONE');
})();