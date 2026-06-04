/**
 * 用 stealth 插件绕过 Cloudflare Turnstile 检测
 * 然后用新邮箱注册 ZO
 */
const puppeteer = require("E:\\API获取工具\\ZO注册\\node_modules\\puppeteer-extra");
const StealthPlugin = require("E:\\API获取工具\\ZO注册\\node_modules\\puppeteer-extra-plugin-stealth");
const { readFileSync, writeFileSync, appendFileSync } = require("fs");

puppeteer.use(StealthPlugin());

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

  console.log("=== ZO Registration (Stealth) ===");
  console.log("Email:", EMAIL);

  // 用 stealth 模式连接浏览器
  const browser = await puppeteer.connect({ browserURL: "http://localhost:9222", timeout: 10000 });
  const pages = await browser.pages();
  const page = pages[0];
  await page.setViewport({ width: 1440, height: 900 });

  // Step 1: 打开注册页
  console.log("\n[1/5] Opening signup...");
  await page.goto("https://www.zo.computer/signup", { waitUntil: "networkidle2", timeout: 30000 });
  await sleep(3000);

  // Step 2: 点击 "Email me a sign-up link"
  console.log("[2/5] Clicking Email button...");
  await page.evaluate(() => {
    const buttons = document.querySelectorAll("button");
    for (const btn of buttons) {
      const directText = Array.from(btn.childNodes).filter(n => n.nodeType === 3).map(n => n.textContent.trim()).join("");
      if (directText === "Email me a sign-up link") { btn.click(); return true; }
    }
    return false;
  });
  await sleep(2000);

  // 填写邮箱
  await page.evaluate((email) => {
    const input = document.getElementById("email") || document.querySelector("input[type=email]");
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(input, email);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, EMAIL);
  await sleep(500);

  // 点击 Continue
  await page.evaluate(() => {
    const buttons = document.querySelectorAll("button");
    for (const btn of buttons) {
      if (btn.textContent.trim() === "Continue") { btn.click(); return; }
    }
  });
  await sleep(3000);
  const sendTime = new Date();
  console.log("[OK] Email sent at " + sendTime.toISOString());

  // Step 3: 等待魔法链接
  console.log("[3/5] Waiting for magic link...");
  const { link, newRefreshToken } = await waitForLink(CLIENT_ID, REFRESH_TOKEN, sendTime);
  console.log("\n[OK] Found: " + link.substring(0, 80));

  if (newRefreshToken !== REFRESH_TOKEN) {
    const newContent = [EMAIL, PASSWORD, CLIENT_ID, newRefreshToken].join("----");
    writeFileSync("C:\\Users\\XZXyuan\\Downloads\\批量注册邮箱\\已经使用\\hilljulia5es7y81c6u8a@outlook.com.txt", newContent, "utf-8");
    console.log("  Token refreshed");
  }

  // Step 4: 打开魔法链接
  console.log("[4/5] Opening magic link...");
  await page.goto(link, { waitUntil: "networkidle2", timeout: 30000 });
  await sleep(8000);

  let url = page.url();
  let bodyText = await page.evaluate(() => document.body?.innerText?.substring(0, 500) || "");
  console.log("URL:", url);
  console.log("Body:", bodyText.substring(0, 200));
  await page.screenshot({ path: "E:\\API获取工具\\ZO注册\\stealth_verify.png", fullPage: false });

  // 等待 Turnstile 自动完成（stealth 模式下应该能自动通过）
  console.log("[5/5] Waiting for Turnstile to auto-complete...");
  
  for (let i = 1; i <= 12; i++) {
    await sleep(5000);
    url = page.url();
    bodyText = await page.evaluate(() => document.body?.innerText?.substring(0, 500) || "");
    console.log("[#" + i + "] URL: " + url.substring(0, 60) + "...");
    console.log("  Body: " + bodyText.substring(0, 150));
    
    // 如果页面显示 "Continue in browser"，点击它
    if (/continue in browser/i.test(bodyText)) {
      console.log("  Clicking 'Continue in browser'...");
      await page.evaluate(() => {
        const all = document.querySelectorAll("button, a, div, span");
        for (const el of all) {
          if (el.textContent.trim() === "Continue in browser") { el.click(); return; }
        }
      });
      await sleep(3000);
    }
    
    // 检查是否成功
    if (/\/dashboard|\/account|\/home|\/welcome|\/settings|\/onboarding/i.test(url)) {
      console.log("\n🎉 [SUCCESS] " + EMAIL + " registered!");
      appendFileSync("E:\\API获取工具\\ZO注册\\results.jsonl", JSON.stringify({ email: EMAIL, status: "success", url, time: new Date().toISOString() }) + "\n");
      await page.screenshot({ path: "E:\\API获取工具\\ZO注册\\stealth_success.png", fullPage: false });
      browser.disconnect();
      return;
    }
    
    if (/invalid|expired|something went wrong/i.test(bodyText)) {
      console.log("\n❌ [FAIL] Link expired or invalid");
      await page.screenshot({ path: "E:\\API获取工具\\ZO注册\\stealth_fail.png", fullPage: false });
      browser.disconnect();
      return;
    }
  }

  await page.screenshot({ path: "E:\\API获取工具\\ZO注册\\stealth_timeout.png", fullPage: false });
  console.log("\n⚠️ [TIMEOUT] URL:", url);
  browser.disconnect();
}

main().catch(e => console.error(e));
