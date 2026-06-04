/**
 * 完整注册流程 v2
 * 
 * 关键修复：
 *   - 发送魔法链接后，通过搜索精确匹配最新收到的 ZO 邮件
 *   - 只打开刚收到的邮件中的链接（避免旧链接过期问题）
 */
const puppeteer = require("E:\\API获取工具\\ZO注册\\node_modules\\puppeteer-core");
const { readFileSync, writeFileSync } = require("fs");

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function sendMagicLink(page, email) {
  await page.goto("https://www.zo.computer/signup", { waitUntil: "networkidle2", timeout: 30000 });
  await sleep(3000);
  
  const clicked = await page.evaluate(() => {
    const buttons = document.querySelectorAll("button");
    for (const btn of buttons) {
      const directText = Array.from(btn.childNodes).filter(n => n.nodeType === 3).map(n => n.textContent.trim()).join("");
      if (directText === "Email me a sign-up link") { btn.click(); return true; }
    }
    return false;
  });
  if (!clicked) throw new Error("Could not click Email button");
  await sleep(2000);
  
  await page.evaluate((email) => {
    const input = document.getElementById("email") || document.querySelector("input[type=email]");
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(input, email);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, email);
  await sleep(500);
  
  const contResult = await page.evaluate(() => {
    const buttons = document.querySelectorAll("button");
    for (const btn of buttons) {
      if (btn.textContent.trim() === "Continue") { btn.click(); return "clicked"; }
    }
    return "not found";
  });
  if (contResult !== "clicked") throw new Error("Could not click Continue");
  await sleep(3000);
  
  const pageText = await page.evaluate(() => document.body?.innerText?.substring(0, 300) || "");
  if (!/check your email|login link/i.test(pageText)) {
    throw new Error("Email send failed: " + pageText.substring(0, 200));
  }
  return true;
}

async function waitForMagicLink(clientId, refreshToken, sendTime) {
  let currentRefreshToken = refreshToken;
  
  for (let attempt = 1; attempt <= 36; attempt++) {
    try {
      const body = new URLSearchParams({
        client_id: clientId, grant_type: "refresh_token", refresh_token: currentRefreshToken,
        scope: "https://graph.microsoft.com/.default offline_access",
      });
      const resp = await fetch("https://login.microsoftonline.com/consumers/oauth2/v2.0/token", {
        method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: body.toString(),
      });
      const data = await resp.json();
      const accessToken = data.access_token;
      currentRefreshToken = data.refresh_token || currentRefreshToken;
      
      // 获取最新 3 封邮件的全文
      const mailResp = await fetch(
        "https://graph.microsoft.com/v1.0/me/messages?$top=3&$select=subject,from,body,receivedDateTime&$orderby=receivedDateTime%20desc",
        { headers: { Authorization: "Bearer " + accessToken } }
      );
      const mail = await mailResp.json();
      
      for (const msg of (mail.value || [])) {
        const msgTime = new Date(msg.receivedDateTime);
        // 只接受发送时间之后的邮件
        if (msgTime < sendTime) continue;
        
        const body = msg.body || {};
        const htmlBody = (body.contentType === "html" && body.content) || "";
        const textBody = (body.contentType === "text" && body.content) || "";
        const combined = (msg.subject || "") + " " + textBody + " " + htmlBody;
        
        // 检查是否是 ZO 的登录邮件
        if (!/log in to zo computer|zo computer/i.test(combined)) continue;
        
        const links = combined.match(/https?:\/\/[^\s"'<>\]]*(?:zo\.computer|zocomputer|cello\.so)[^\s"'<>\]]*/gi) || [];
        for (let link of links) {
          link = link.replace(/[)\]>,;:.!?]+$/, "").replace(/&amp;/g, "&");
          if (link.includes("/api/email-login/verify")) {
            console.log(`  Found at attempt ${attempt}, time: ${msg.receivedDateTime}`);
            return { link, nextRefreshToken: currentRefreshToken };
          }
        }
      }
      
      process.stdout.write(".");
      await sleep(5000);
    } catch (err) {
      console.log("\n[WARN] " + err.message);
      await sleep(5000);
    }
  }
  
  throw new Error("Magic link not found");
}

async function openLinkAndComplete(page, magicLink) {
  console.log("Opening magic link...");
  await page.goto(magicLink, { waitUntil: "domcontentloaded", timeout: 30000 });
  await sleep(5000);
  
  let url = page.url();
  let bodyText = await page.evaluate(() => document.body?.innerText?.substring(0, 500) || "");
  console.log("URL:", url);
  
  // 处理浏览器验证
  for (let check = 1; check <= 5; check++) {
    if (/verifying|browser check|complete the browser|hang tight|redirecting/i.test(bodyText)) {
      console.log(`[Check ${check}] Verification/redirect in progress...`);
      
      // 点击 "Continue in browser"
      await page.evaluate(() => {
        const all = document.querySelectorAll("button, a, div, span");
        for (const el of all) {
          if (el.textContent.trim() === "Continue in browser") {
            el.click();
            return true;
          }
        }
        return false;
      });
      
      await sleep(10000);
      url = page.url();
      bodyText = await page.evaluate(() => document.body?.innerText?.substring(0, 500) || "");
      console.log("URL:", url);
      console.log("Body:", bodyText.substring(0, 200));
    } else {
      break;
    }
  }
  
  // 最终检查
  await sleep(5000);
  url = page.url();
  await page.setViewport({ width: 1440, height: 900 });
  await page.screenshot({ path: "E:\\API获取工具\\ZO注册\\final_" + Date.now() + ".png", fullPage: false });
  
  const isDashboard = /\/dashboard|\/account|\/home|\/welcome|\/settings|\/onboarding/i.test(url);
  const isError = /something went wrong|error|expired|invalid/i.test(bodyText);
  
  if (isDashboard) return "success";
  if (isError) return "expired";
  
  // 如果还在 verify 页面但没错误，可能还在处理
  if (/email-login\/verify/i.test(url)) {
    console.log("Still on verify page, waiting 15s...");
    await sleep(15000);
    url = page.url();
    await page.screenshot({ path: "E:\\API获取工具\ZO注册\final2_" + Date.now() + ".png", fullPage: false });
    if (/\/dashboard|\/account|\/home|\/welcome/i.test(url)) return "success";
  }
  
  return "unknown:" + url;
}

async function main() {
  const content = readFileSync("C:\\Users\\XZXyuan\\Downloads\\批量注册邮箱\\已经使用\\emma86296css4m95phvvo@outlook.com.txt", "utf-8").trim();
  const parts = content.split("----").map(s => s.trim());
  const EMAIL = parts[0];
  const PASSWORD = parts[1];
  const CLIENT_ID = parts[2];
  const REFRESH_TOKEN = parts[3];
  
  console.log("=== ZO Registration v2 ===");
  console.log("Email:", EMAIL);
  
  const browser = await puppeteer.connect({ browserURL: "http://localhost:9222", timeout: 10000 });
  const pages = await browser.pages();
  const page = pages[0];
  await page.setViewport({ width: 1440, height: 900 });
  
  try {
    // Step 1: 发送魔法链接
    console.log("\n[1/3] Sending magic link...");
    await sendMagicLink(page, EMAIL);
    const sendTime = new Date();
    console.log("[OK] Email sent at " + sendTime.toISOString());
    
    // Step 2: 等待邮件到达
    console.log("[2/3] Waiting for magic link email...");
    const { link, nextRefreshToken } = await waitForMagicLink(CLIENT_ID, REFRESH_TOKEN, sendTime);
    console.log("[OK] Found: " + link.substring(0, 100));
    
    // 保存刷新后的 token
    if (nextRefreshToken !== REFRESH_TOKEN) {
      const newContent = EMAIL + "----" + PASSWORD + "----" + CLIENT_ID + "----" + nextRefreshToken;
      writeFileSync("C:\\Users\\XZXyuan\\Downloads\\批量注册邮箱\\已经使用\\emma86296css4m95phvvo@outlook.com.txt", newContent, "utf-8");
      console.log("  Token refreshed");
    }
    
    // Step 3: 打开链接完成注册
    console.log("[3/3] Completing registration...");
    const result = await openLinkAndComplete(page, link);
    
    if (result === "success") {
      console.log("\n🎉 [SUCCESS] " + EMAIL + " registered!");
    } else if (result === "expired") {
      console.log("\n❌ [FAIL] Link expired. Need to resend.");
    } else {
      console.log("\n⚠️ [DONE] Result: " + result);
    }
    
  } catch (err) {
    console.log("\n[ERROR] " + err.message);
  }
  
  browser.disconnect();
}

main().catch(e => console.error(e));
