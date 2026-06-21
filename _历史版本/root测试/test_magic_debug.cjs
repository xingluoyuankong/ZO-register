// Debug: Open a fresh magic link, take screenshots at each step
const puppeteer = require('E:\\API获取工具\\ZO注册\\node_modules\\puppeteer-core');
const { readFileSync } = require('fs');
const { join } = require('path');

const CONFIG = {
  EMAIL_DIR: "C:\\Users\\XZXyuan\\Downloads\\批量注册邮箱\\已经使用",
  GRAPH_TOKEN_URL: "https://login.microsoftonline.com/consumers/oauth2/v2.0/token",
  GRAPH_MAIL_URL: "https://graph.microsoft.com/v1.0/me/messages",
  SIGNUP_URL: "https://www.zo.computer/signup",
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
  
  // Read email credentials
  const emailFile = join(CONFIG.EMAIL_DIR, 'sanchezquinncu3w1kkhtuc74@outlook.com__Pxcuyi6K50yVZPnD.txt');
  const content = readFileSync(emailFile, 'utf-8').trim();
  const [email, password, clientId, refreshToken] = content.split('----').map(s => s.trim());
  console.log('Email:', email);
  
  // Get fresh magic link
  const body = new URLSearchParams({
    client_id: clientId, grant_type: 'refresh_token', refresh_token: refreshToken,
    scope: 'https://graph.microsoft.com/.default offline_access',
  });
  const tokenResp = await fetch(CONFIG.GRAPH_TOKEN_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString(),
  });
  const tokenData = await tokenResp.json();
  const accessToken = tokenData.access_token;
  
  // Get latest email
  const mailResp = await fetch(CONFIG.GRAPH_MAIL_URL + '?$top=1&$select=subject,body,receivedDateTime&$orderby=receivedDateTime%20desc', {
    headers: { Authorization: 'Bearer ' + accessToken }
  });
  const mail = await mailResp.json();
  const msg = mail.value[0];
  const combined = (msg.subject || '') + ' ' + ((msg.body && msg.body.content) || '');
  const links = combined.match(/https:\/\/www\.zo\.computer\/api\/email-login\/verify[^\s"'<>]*/gi) || [];
  let link = links[0] || '';
  link = link.replace(/[)\]>,;!?\s]+$/, '').replace(/&amp;/g, '&');
  console.log('Link found:', link.substring(0, 80) + '...');
  console.log('Email received:', msg.receivedDateTime);
  
  // Create new context and open the link
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.evaluateOnNewDocument(TURNSTILE_PATCH);
  
  console.log('\n--- Opening magic link ---');
  await page.goto(link, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(3000);
  
  // Screenshot 1: Initial state
  await page.screenshot({ path: join(CONFIG.DEBUG_DIR, 'debug_magic_1_initial.png'), fullPage: true });
  console.log('Screenshot 1: Initial state saved');
  
  // Get page text
  let bodyText = await page.evaluate(() => document.body ? document.body.innerText : '');
  console.log('\nPage text (first 500 chars):');
  console.log(bodyText.substring(0, 500));
  
  // Check for Turnstile
  const tsInfo = await page.evaluate(() => {
    const result = {};
    result.cfBypass = !!window.__CF_BYPASS__;
    result.webdriver = navigator.webdriver;
    
    // Check for turnstile widget
    const widget = document.querySelector('[data-sitekey]');
    result.widgetFound = !!widget;
    if (widget) result.sitekey = widget.getAttribute('data-sitekey');
    
    // Check for turnstile iframe
    const iframes = document.querySelectorAll('iframe');
    result.iframeCount = iframes.length;
    result.iframes = Array.from(iframes).map(f => ({ src: f.src.substring(0, 100), visible: f.offsetParent !== null }));
    
    // Check turnstile API
    try { result.turnstileExists = typeof turnstile !== 'undefined'; } catch(e) {}
    try { if (typeof turnstile !== 'undefined') { result.turnstileResponse = turnstile.getResponse(); } } catch(e) {}
    
    // Check for cf-turnstile-response input
    const cfInput = document.querySelector('input[name="cf-turnstile-response"]');
    result.cfInputFound = !!cfInput;
    if (cfInput) result.cfInputValue = cfInput.value ? cfInput.value.substring(0, 50) : 'empty';
    
    // Check URL
    result.url = location.href;
    
    return result;
  });
  console.log('\nTurnstile info:', JSON.stringify(tsInfo, null, 2));
  
  // Wait 10 seconds and take another screenshot
  console.log('\n--- Waiting 10 seconds ---');
  await sleep(10000);
  
  await page.screenshot({ path: join(CONFIG.DEBUG_DIR, 'debug_magic_2_after10s.png'), fullPage: true });
  console.log('Screenshot 2: After 10s saved');
  
  bodyText = await page.evaluate(() => document.body ? document.body.innerText : '');
  console.log('\nPage text after 10s (first 500 chars):');
  console.log(bodyText.substring(0, 500));
  
  const url2 = page.url();
  console.log('URL after 10s:', url2);
  
  // Wait 10 more seconds
  console.log('\n--- Waiting 10 more seconds ---');
  await sleep(10000);
  
  await page.screenshot({ path: join(CONFIG.DEBUG_DIR, 'debug_magic_3_after20s.png'), fullPage: true });
  console.log('Screenshot 3: After 20s saved');
  
  bodyText = await page.evaluate(() => document.body ? document.body.innerText : '');
  console.log('\nPage text after 20s (first 500 chars):');
  console.log(bodyText.substring(0, 500));
  
  const url3 = page.url();
  console.log('URL after 20s:', url3);
  
  // Check if URL changed
  if (url3 !== url2) {
    console.log('\n*** URL CHANGED! ***');
  }
  
  // Close context
  await context.close();
  browser.disconnect();
  console.log('\nDone!');
})().catch(e => console.error('Error:', e.message));
