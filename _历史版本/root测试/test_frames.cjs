// Debug: Find Turnstile iframe using puppeteer frames API
const puppeteer = require('E:\\API获取工具\\ZO注册\\node_modules\\puppeteer-core');
const { readFileSync } = require('fs');
const { join } = require('path');

const CONFIG = {
  EMAIL_DIR: "C:\\Users\\XZXyuan\\Downloads\\批量注册邮箱\\已经使用",
  GRAPH_TOKEN_URL: "https://login.microsoftonline.com/consumers/oauth2/v2.0/token",
  GRAPH_MAIL_URL: "https://graph.microsoft.com/v1.0/me/messages",
  DEBUG_DIR: "E:\\API获取工具\\ZO注册\\registered",
};

const TURNSTILE_PATCH = `(function(){
  if(window.__CF_BYPASS__)return;window.__CF_BYPASS__=true;
  var X=100+Math.floor(Math.random()*100),Y=60+Math.floor(Math.random()*80);
  var D=function(o,p,g){try{Object.defineProperty(o,p,{get:g,configurable:true,enumerable:true})}catch(e){}};
  D(MouseEvent.prototype,'screenX',function(){return(this.clientX||0)+X});
  D(MouseEvent.prototype,'screenY',function(){return(this.clientY||0)+Y});
  D(PointerEvent.prototype,'screenX',function(){return(this.clientX||0)+X});
  D(PointerEvent.prototype,'screenY',function(){return(this.clientY||0)+Y});
})();`;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const browser = await puppeteer.connect({ browserURL: 'http://localhost:9222', defaultViewport: null, timeout: 10000 });
  
  // Get fresh magic link
  const emailFile = join(CONFIG.EMAIL_DIR, 'sanchezquinncu3w1kkhtuc74@outlook.com__Pxcuyi6K50yVZPnD.txt');
  const content = readFileSync(emailFile, 'utf-8').trim();
  const [email, password, clientId, refreshToken] = content.split('----').map(s => s.trim());
  
  const body = new URLSearchParams({
    client_id: clientId, grant_type: 'refresh_token', refresh_token: refreshToken,
    scope: 'https://graph.microsoft.com/.default offline_access',
  });
  const tokenResp = await fetch(CONFIG.GRAPH_TOKEN_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString(),
  });
  const tokenData = await tokenResp.json();
  const accessToken = tokenData.access_token;
  
  // Send new email first
  console.log('Sending new magic link email...');
  const sendResp = await fetch('https://www.zo.computer/api/email-login/request', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: email }),
  });
  console.log('Send response status:', sendResp.status);
  await sleep(5000);
  
  // Get the new link
  const mailResp = await fetch(CONFIG.GRAPH_MAIL_URL + '?$top=1&$select=subject,body,receivedDateTime&$orderby=receivedDateTime%20desc', {
    headers: { Authorization: 'Bearer ' + accessToken }
  });
  const mail = await mailResp.json();
  const msg = mail.value[0];
  const combined = (msg.subject || '') + ' ' + ((msg.body && msg.body.content) || '');
  const links = combined.match(/https:\/\/www\.zo\.computer\/api\/email-login\/verify[^\s"'<>]*/gi) || [];
  let link = links[0] || '';
  link = link.replace(/[)\]>,;!?\s]+$/, '').replace(/&amp;/g, '&');
  console.log('Fresh link found:', link.substring(0, 80) + '...');
  
  // Create new context and open the link
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.evaluateOnNewDocument(TURNSTILE_PATCH);
  
  console.log('\n--- Opening fresh magic link ---');
  await page.goto(link, { waitUntil: 'networkidle0', timeout: 60000 }).catch(() => {});
  await sleep(5000);
  
  // List ALL frames using puppeteer API
  const frames = page.frames();
  console.log('\n=== All Frames (' + frames.length + ') ===');
  for (const frame of frames) {
    console.log('  Frame: ' + frame.url().substring(0, 100));
    console.log('    Name: ' + (frame.name() || '(none)'));
    console.log('    Detached: ' + frame.detached());
    
    // Check if this is a Turnstile frame
    if (frame.url().includes('challenges.cloudflare.com') || frame.url().includes('turnstile')) {
      console.log('    *** TURNSTILE FRAME FOUND! ***');
      
      try {
        const tsContent = await frame.evaluate(() => {
          return {
            bodyText: document.body ? document.body.innerText.substring(0, 300) : 'no body',
            checkbox: !!document.querySelector('input[type=checkbox]'),
            button: !!document.querySelector('button'),
            allElements: document.querySelectorAll('*').length,
          };
        });
        console.log('    Content:', JSON.stringify(tsContent, null, 2));
      } catch(e) {
        console.log('    Cannot access frame content:', e.message);
      }
    }
  }
  
  // Try to find and click the Turnstile checkbox
  console.log('\n--- Looking for Turnstile checkbox ---');
  const turnstileFrame = frames.find(f => f.url().includes('challenges.cloudflare.com'));
  if (turnstileFrame) {
    console.log('Found Turnstile frame!');
    try {
      // Try clicking the checkbox
      const checkbox = await turnstileFrame.$('input[type=checkbox]');
      if (checkbox) {
        console.log('Found checkbox, clicking...');
        await checkbox.click();
        await sleep(5000);
      } else {
        console.log('No checkbox found, trying to click body...');
        await turnstileFrame.click('body').catch(() => {});
        await sleep(5000);
      }
      
      // Check response after click
      const response = await page.evaluate(() => {
        const input = document.querySelector('input[name="cf-turnstile-response"]');
        return input ? input.value : 'no input';
      });
      console.log('Turnstile response after click:', response ? response.substring(0, 50) + '...' : 'empty');
    } catch(e) {
      console.log('Error interacting with Turnstile frame:', e.message);
    }
  } else {
    console.log('No Turnstile frame found');
    
    // Try clicking anywhere on the page where the checkbox might be
    console.log('Trying to click on the page where checkbox should be...');
    // The checkbox is typically in the center-left area
    await page.mouse.click(250, 300);
    await sleep(3000);
    await page.screenshot({ path: join(CONFIG.DEBUG_DIR, 'debug_after_click.png'), fullPage: true });
  }
  
  // Final state
  await page.screenshot({ path: join(CONFIG.DEBUG_DIR, 'debug_final_state.png'), fullPage: true });
  const finalText = await page.evaluate(() => document.body ? document.body.innerText.substring(0, 300) : '');
  console.log('\nFinal page text:', finalText);
  console.log('Final URL:', page.url());
  
  await context.close();
  browser.disconnect();
  console.log('\nDone!');
})().catch(e => console.error('Error:', e.message));
