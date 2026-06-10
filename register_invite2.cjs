/**
 * 用邀请链接 + 新邮箱注册 ZO
 * 直接用 zo.computer 带参数，避免 cello.so 超时
 */
const puppeteer = require("E:\\API获取工具\\ZO注册\\node_modules\\puppeteer-core");
const { readFileSync, writeFileSync, appendFileSync } = require("fs");

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function getMailToken(clientId, refreshToken) {
  const body = new URLSearchParams({
    client_id: clientId, grant_type: "refresh_token", refresh_token: refreshToken,
    scope: "https://graph.microsoft.com/.default offline_access",
  });
  const resp = await fetch("https://login.microsoftonline.com/consumers/oauth2/v2.0/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: body.toString(),
  });
  const data = await resp.json();
  return { accessToken: data.access_token, newRefreshToken: data.refresh_token || refreshToken };
}

async function findMagicLink(accessToken, sendTime) {
  const mailResp = await fetch(
    "https://graph.microsoft.com/v1.0/me/messages?$top=5&$select=subject,from,body,receivedDateTime&$orderby=receivedDateTime%20desc",
    { headers: { Authorization: "Bearer " + accessToken } }
  );
  const mail = await mailResp.json();
  for (const msg of (mail.value || [])) {
    const msgTime = new Date(msg.receivedDateTime);
    if (msgTime < sendTime) continue;
    const body = msg.body || {};
    const combined = (msg.subject || "") + " " + ((body.content || ""));
    if (!/log in to zo computer|zo computer/i.test(combined)) continue;
    const links = combined.match(/https?:\/\/[^\s"'<>\]]*(?:zo\.computer|zocomputer|cello\.so)[^\s"'<>\]]*/gi) || [];
    for (let link of links) {
      link = link.replace(/[)\]>,;:.!?]+$/, "").replace(/&amp;/g, "&");
      if (link.includes("/api/email-login/verify")) return link;
    }
  }
  return null;
}

async function waitForLink(clientId, refreshToken, sendTime) {
  let rt = refreshToken;
  for (let i = 1; i <= 36; i++) {
    const { accessToken, newRefreshToken } = await getMailToken(clientId, rt);
    rt = newRefreshToken;
    const link = await findMagicLink(accessToken, sendTime);
    if (link) return { link, newRefreshToken: rt };
    process.stdout.write(".");
    await sleep(5000);
  }
  throw new Error("Magic link not found after 3 minutes");
}

async function main() {
  const content = readFileSync("C:\\Users\\XZXyuan\\Downloads\\批量注册邮箱\\已经使用\\hilljulia5es7y81c6u8a@outlook.com.txt", "utf-8").trim();
  const parts = content.split("----").map(s => s.trim());
  const EMAIL = parts[0];
  const PASSWORD = parts[1];
  const CLIENT_ID = parts[2];
  const REFRESH_TOKEN = parts[3];

  console.log("=== ZO Registration (Invite) ===");
  console.log("Email:", EMAIL);

  const browser = await puppeteer.connect({ browserURL: "http://localhost:9222", timeout: 10000 });
  const pages = await browser.pages();
  const page = pages[0];
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

  // Step 1: 打开 ZO 首页（带邀请参数）
  console.log("\n[1/5] Opening ZO with invite params...");
  await page.goto("https://www.zo.computer/?productId=www.zo.computer&ucc=XczDkTYgFpn&celloN=MzIxNDY3NTc3MQ", { waitUntil: "networkidle2", timeout: 30000 });
  await sleep(3000);
  console.log("URL:", page.url());

  // Step 2: 点击 Sign up
  console.log("[2/5] Clicking Sign up...");
  await page.evaluate(() => {
    const links = document.querySelectorAll("a[href*='signup']");
    for (const a of links) {
      if (a.textContent.trim() === "Sign up") { a.click(); return true; }
    }
    // 备用：直接导航
    window.location.href = "/signup";
    return false;
  });
  await sleep(3000);
  console.log("URL:", page.url());

  // Step 3: 点击 "Email me a sign-up link" 并填写邮箱
  console.log("[3/5] Filling email...");
  const clicked = await page.evaluate(() => {
    const buttons = document.querySelectorAll("button");
    for (const btn of buttons) {
      const directText = Array.from(btn.childNodes).filter(n => n.nodeType === 3).map(n => n.textContent.trim()).join("");
      if (directText === "Email me a sign-up link") { btn.click(); return true; }
    }
    return false;
  });
  if (!clicked) { console.log("[FAIL] Email button not found"); browser.disconnect(); return; }
  await sleep(2000);

  await page.evaluate((email) => {
    const input = document.getElementById("email") || document.querySelector("input[type=email]");
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(input, email);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, EMAIL);
  await sleep(500);

  await page.evaluate(() => {
    const buttons = document.querySelectorAll("button");
    for (const btn of buttons) {
      if (btn.textContent.trim() === "Continue") { btn.click(); return; }
    }
  });
  await sleep(3000);

  const pageText = await page.evaluate(() => document.body?.innerText?.substring(0, 300) || "");
  console.log("Body:", pageText.substring(0, 150));
  const sendTime = new Date();
  console.log("[OK] Email sent at " + sendTime.toISOString());

  // Step 4: 等待魔法链接
  console.log("[4/5] Waiting for magic link...");
  const { link, newRefreshToken } = await waitForLink(CLIENT_ID, REFRESH_TOKEN, sendTime);
  console.log("\n[OK] Found: " + link.substring(0, 80));

  if (newRefreshToken !== REFRESH_TOKEN) {
    const newContent = [EMAIL, PASSWORD, CLIENT_ID, newRefreshToken].join("----");
    writeFileSync("C:\\Users\\XZXyuan\\Downloads\\批量注册邮箱\\已经使用\\hilljulia5es7y81c6u8a@outlook.com.txt", newContent, "utf-8");
    console.log("  Token refreshed");
  }

  // Step 5: 打开魔法链接
  console.log("[5/5] Opening magic link...");
  await page.evaluate((l) => { window.location.href = l; }, link);
  await sleep(10000);

  let url = page.url();
  let bodyText = await page.evaluate(() => document.body?.innerText?.substring(0, 500) || "");
  console.log("URL:", url);
  console.log("Body:", bodyText.substring(0, 200));
  await page.screenshot({ path: "E:\\API获取工具\\ZO注册\\invite_step5.png", fullPage: false });

  // 处理浏览器验证
  if (/verifying|browser check|complete the browser/i.test(bodyText)) {
    console.log("  Clicking 'Continue in browser'...");
    await page.evaluate(() => {
      const all = document.querySelectorAll("button, a, div, span");
      for (const el of all) {
        if (el.textContent.trim() === "Continue in browser") { el.click(); return; }
      }
    });
    await sleep(15000);
    url = page.url();
    bodyText = await page.evaluate(() => document.body?.innerText?.substring(0, 500) || "");
    console.log("URL:", url);
    console.log("Body:", bodyText.substring(0, 200));
    await page.screenshot({ path: "E:\\API获取工具\\ZO注册\\invite_after_verify.png", fullPage: false });
  }

  // 等待跳转
  for (let i = 0; i < 6; i++) {
    const isDashboard = /\/dashboard|\/account|\/home|\/welcome|\/settings|\/onboarding/i.test(url);
    const isError = /something went wrong|expired|invalid/i.test(bodyText);
    if (isDashboard || isError) break;
    await sleep(10000);
    url = page.url();
    bodyText = await page.evaluate(() => document.body?.innerText?.substring(0, 300) || "");
    console.log("[wait] URL:", url);
  }

  await page.screenshot({ path: "E:\\API获取工具\\ZO注册\\invite_final.png", fullPage: false });

  const isDashboard = /\/dashboard|\/account|\/home|\/welcome|\/settings|\/onboarding/i.test(url);
  const isError = /something went wrong|expired|invalid/i.test(bodyText);

  if (isDashboard) {
    console.log("\n🎉 [SUCCESS] " + EMAIL + " registered!");
    appendFileSync("E:\\API获取工具\\ZO注册\\results.jsonl", JSON.stringify({ email: EMAIL, status: "success", url, time: new Date().toISOString() }) + "\n");
  } else if (isError) {
    console.log("\n❌ [FAIL] " + bodyText.substring(0, 200));
    appendFileSync("E:\\API获取工具\\ZO注册\\results.jsonl", JSON.stringify({ email: EMAIL, status: "fail", reason: bodyText.substring(0, 100), time: new Date().toISOString() }) + "\n");
  } else {
    console.log("\n⚠️ [DONE] URL:", url);
    appendFileSync("E:\\API获取工具\\ZO注册\\results.jsonl", JSON.stringify({ email: EMAIL, status: "unknown", url, time: new Date().toISOString() }) + "\n");
  }

  browser.disconnect();
}

main().catch(e => console.error(e));
