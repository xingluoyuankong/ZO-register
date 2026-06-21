const fs = require("fs");
const puppeteer = require("E:\\API获取工具\\ZO注册\\node_modules\\puppeteer-core");

const CDP_PORT = 64610;
const GRAPH_TOKEN_URL = "https://login.microsoftonline.com/consumers/oauth2/v2.0/token";
const GRAPH_MAIL_URL = "https://graph.microsoft.com/v1.0/me/messages";

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function getMailToken(clientId, refreshToken) {
  const body = new URLSearchParams({
    client_id: clientId, grant_type: "refresh_token", refresh_token: refreshToken,
    scope: "https://graph.microsoft.com/.default offline_access",
  });
  const resp = await fetch(GRAPH_TOKEN_URL, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: body.toString(),
  });
  const data = await resp.json();
  return { accessToken: data.access_token, newRefreshToken: data.refresh_token || refreshToken };
}

async function main() {
  const content = fs.readFileSync("C:\\Users\\XZXyuan\\Downloads\\批量注册邮箱\\已经使用\\amelida35vsrxp601u61w9@outlook.com.txt", "utf-8").trim();
  const [email, password, clientId, refreshToken] = content.split("----").map(s => s.trim());

  // Get latest ZO link
  const { accessToken, newRefreshToken } = await getMailToken(clientId, refreshToken);
  const url = GRAPH_MAIL_URL + "?$top=3&$select=subject,body,receivedDateTime&$orderby=receivedDateTime%20desc";
  const mailResp = await fetch(url, { headers: { Authorization: "Bearer " + accessToken } });
  const mail = await mailResp.json();
  
  let link = null;
  for (const msg of (mail.value || [])) {
    const combined = (msg.subject || "") + " " + ((msg.body && msg.body.content) || "");
    if (!/zo\s*computer/i.test(combined)) continue;
    const links = combined.match(/https:\/\/www\.zo\.computer\/api\/email-login\/verify[^\s"'<>]*/gi) || [];
    for (let l of links) {
      l = l.replace(/[)\]>,;!?\s]+$/, "").replace(/&amp;/g, "&");
      if (l.includes("token=")) { link = l; break; }
    }
    if (link) break;
  }
  
  if (!link) { console.log("No link found!"); return; }
  console.log("Link:", link.substring(0, 100) + "...");
  
  // Open in browser
  const browser = await puppeteer.connect({ browserURL: "http://localhost:" + CDP_PORT, timeout: 5000 });
  console.log("Browser connected");
  
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ width: 1440, height: 900 });

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
  
  console.log("Opening link...");
  await page.goto(link, { waitUntil: "domcontentloaded", timeout: 30000 });
  await sleep(5000);
  
  // Wait for Turnstile
  console.log("Waiting Turnstile...");
  for (let i = 0; i < 20; i++) {
    const txt = await page.evaluate(() => document.body.innerText.substring(0, 500));
    console.log(`[${i*3}s] ${txt.substring(0, 80)}`);
    if (!/verifying your browser|complete the browser check/i.test(txt)) break;
    await sleep(3000);
  }
  
  // Click "Continue in browser"
  console.log("Clicking Continue in browser...");
  await page.evaluate(() => {
    for (const el of document.querySelectorAll("button, a, div, span")) {
      const textNodes = Array.from(el.childNodes).filter(n => n.nodeType === 3).map(n => n.textContent.trim()).join("");
      if (/Continue in browser/i.test(textNodes)) { el.click(); return; }
    }
  });
  await sleep(5000);
  
  // Wait for handle page
  console.log("Waiting for handle page...");
  for (let i = 0; i < 15; i++) {
    const txt = await page.evaluate(() => document.body.innerText.substring(0, 300));
    console.log(`[${i*3}s] ${txt.substring(0, 80)}`);
    if (/choose your handle/i.test(txt)) break;
    if (/invalid|expired/i.test(txt)) { console.log("EXPIRED!"); return; }
    await sleep(3000);
  }
  
  // Fill handle
  const handle = "user" + Math.random().toString(36).substring(2, 8);
  console.log("Handle:", handle);
  await page.evaluate((h) => {
    const inp = document.querySelector("input[placeholder='you']") || document.querySelector("input[type=text]");
    if (inp) {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      setter.call(inp, h);
      inp.dispatchEvent(new Event("input", { bubbles: true }));
      inp.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }, handle);
  await sleep(1000);
  
  // Click Continue
  await page.evaluate(() => {
    for (const el of document.querySelectorAll("button")) {
      if (/^Continue$/i.test(el.textContent.trim())) { el.click(); return; }
    }
  });
  await sleep(5000);
  
  // Wait for boot
  console.log("Waiting for boot...");
  for (let i = 1; i <= 30; i++) {
    await sleep(5000);
    const txt = await page.evaluate(() => document.body.innerText.substring(0, 300));
    const pct = txt.match(/(\d+\.?\d*)%/);
    if (pct && i % 2 === 0) console.log("Boot: " + pct[1] + "%");
    if (/go to your zo/i.test(txt)) {
      console.log("BOOT COMPLETE!");
      await page.evaluate(() => {
        for (const el of document.querySelectorAll("button, a")) {
          if (/go to your zo/i.test(el.textContent.trim())) { el.click(); return; }
        }
      });
      await sleep(5000);
      console.log("URL:", page.url());
      console.log("DONE!");
      break;
    }
  }
  
  await page.close().catch(() => {});
  await context.close().catch(() => {});
  browser.disconnect().catch(() => {});
}

main().catch(e => console.error(e));
