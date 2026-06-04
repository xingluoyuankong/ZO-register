/**
 * 完整注册流程 v3 — 一气呵成版
 * 
 * 关键：发送魔法链接 → 立刻打开，中间不要有其他操作
 */
const puppeteer = require("E:\\API获取工具\\ZO注册\\node_modules\\puppeteer-core");
const { readFileSync, writeFileSync } = require("fs");

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  // 读取 emma86296 的凭证
  const content = readFileSync("C:\\Users\\XZXyuan\\Downloads\\批量注册邮箱\\已经使用\\emma86296css4m95phvvo@outlook.com.txt", "utf-8").trim();
  const parts = content.split("----").map(s => s.trim());
  const EMAIL = parts[0];
  const PASSWORD = parts[1];
  const CLIENT_ID = parts[2];
  const REFRESH_TOKEN = parts[3];
  
  console.log("=== ZO Registration v3 (One-shot) ===");
  console.log("Email:", EMAIL);
  
  const browser = await puppeteer.connect({ browserURL: "http://localhost:9222", timeout: 10000 });
  const pages = await browser.pages();
  const page = pages[0];
  await page.setViewport({ width: 1440, height: 900 });
  
  // ========== Step 1: 打开注册页，填写邮箱 ==========
  console.log("\n[Step 1] Opening ZO signup...");
  await page.goto("https://www.zo.computer/signup", { waitUntil: "networkidle2", timeout: 30000 });
  await sleep(3000);
  
  // 点击 "Email me a sign-up link"
  const clicked = await page.evaluate(() => {
    const buttons = document.querySelectorAll("button");
    for (const btn of buttons) {
      const directText = Array.from(btn.childNodes).filter(n => n.nodeType === 3).map(n => n.textContent.trim()).join("");
      if (directText === "Email me a sign-up link") { btn.click(); return true; }
    }
    return false;
  });
  if (!clicked) { console.log("[FAIL] Could not click Email button"); browser.disconnect(); return; }
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
  const contResult = await page.evaluate(() => {
    const buttons = document.querySelectorAll("button");
    for (const btn of buttons) {
      if (btn.textContent.trim() === "Continue") { btn.click(); return "clicked"; }
    }
    return "not found";
  });
  if (contResult !== "clicked") { console.log("[FAIL] Could not click Continue"); browser.disconnect(); return; }
  await sleep(3000);
  
  console.log("[OK] Email sent, waiting for link...");
  
  // ========== Step 2: 立刻获取魔法链接 ==========
  let currentRefreshToken = REFRESH_TOKEN;
  let magicLink = null;
  
  for (let attempt = 1; attempt <= 36; attempt++) {
    try {
      const body = new URLSearchParams({
        client_id: CLIENT_ID, grant_type: "refresh_token", refresh_token: currentRefreshToken,
        scope: "https://graph.microsoft.com/.default offline_access",
      });
      const resp = await fetch("https://login.microsoftonline.com/consumers/oauth2/v2.0/token", {
        method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: body.toString(),
      });
      const data = await resp.json();
      const accessToken = data.access_token;
      currentRefreshToken = data.refresh_token || currentRefreshToken;
      
      const mailResp = await fetch(
        "https://graph.microsoft.com/v1.0/me/messages?$top=3&$select=subject,from,body,receivedDateTime&$orderby=receivedDateTime%20desc",
        { headers: { Authorization: "Bearer " + accessToken } }
      );
      const mail = await mailResp.json();
      
      for (const msg of (mail.value || [])) {
        const body = msg.body || {};
        const htmlBody = (body.contentType === "html" && body.content) || "";
        const textBody = (body.contentType === "text" && body.content) || "";
        const combined = (msg.subject || "") + " " + textBody + " " + htmlBody;
        
        if (!/log in to zo computer|zo computer/i.test(combined)) continue;
        
        const links = combined.match(/https?:\/\/[^\s"'<>\]]*(?:zo\.computer|zocomputer|cello\.so)[^\s"'<>\]]*/gi) || [];
        for (let link of links) {
          link = link.replace(/[)\]>,;:.!?]+$/, "").replace(/&amp;/g, "&");
          if (link.includes("/api/email-login/verify")) {
            magicLink = link;
            break;
          }
        }
        if (magicLink) break;
      }
      
      if (magicLink) {
        console.log("[OK] Magic link found (attempt " + attempt + ")");
        break;
      }
      
      process.stdout.write(".");
      await sleep(5000);
    } catch (err) {
      console.log("\n[WARN] " + err.message);
      await sleep(5000);
    }
  }
  
  if (!magicLink) { console.log("\n[FAIL] Magic link not found"); browser.disconnect(); return; }
  
  // 保存刷新后的 token
  if (currentRefreshToken !== REFRESH_TOKEN) {
    const newContent = EMAIL + "----" + PASSWORD + "----" + CLIENT_ID + "----" + currentRefreshToken;
    writeFileSync("C:\\Users\\XZXyuan\\Downloads\\批量注册邮箱\\已经使用\\emma86296css4m95phvvo@outlook.com.txt", newContent, "utf-8");
    console.log("  Token refreshed");
  }
  
  // ========== Step 3: 立刻在浏览器中打开魔法链接 ==========
  console.log("[Step 3] Opening magic link...");
  console.log("  " + magicLink.substring(0, 100));
  
  // 用 window.location.href 在同域页面中跳转
  await page.evaluate((link) => { window.location.href = link; }, magicLink);
  
  // 等待页面跳转
  await sleep(8000);
  
  let url = page.url();
  console.log("URL:", url);
  await page.screenshot({ path: "E:\\API获取工具\\ZO注册\\v3_step3.png", fullPage: false });
  
  // ========== Step 4: 处理浏览器验证 ==========
  let bodyText = await page.evaluate(() => document.body?.innerText?.substring(0, 500) || "");
  console.log("Body:", bodyText.substring(0, 200));
  
  if (/verifying|browser check|complete the browser/i.test(bodyText)) {
    console.log("[Step 4] Clicking 'Continue in browser'...");
    await page.evaluate(() => {
      const all = document.querySelectorAll("button, a, div, span");
      for (const el of all) {
        const t = el.textContent.trim();
        if (t === "Continue in browser" || t === "Complete browser check") {
          el.click();
          return "clicked: " + t;
        }
      }
      return "not found";
    });
    
    // 等待验证完成
    console.log("[Step 5] Waiting for verification...");
    await sleep(20000);
    
    url = page.url();
    bodyText = await page.evaluate(() => document.body?.innerText?.substring(0, 500) || "");
    console.log("URL:", url);
    console.log("Body:", bodyText.substring(0, 200));
    await page.screenshot({ path: "E:\\API获取工具\\ZO注册\\v3_step5.png", fullPage: false });
  }
  
  // ========== 检查结果 ==========
  const isDashboard = /\/dashboard|\/account|\/home|\/welcome|\/settings|\/onboarding/i.test(url);
  const isError = /something went wrong|error|expired|invalid/i.test(bodyText);
  const isStillVerify = /email-login\/verify/i.test(url);
  
  if (isDashboard) {
    console.log("\n🎉 [SUCCESS] " + EMAIL + " registered!");
  } else if (isError) {
    console.log("\n❌ [FAIL] " + bodyText.substring(0, 200));
  } else if (isStillVerify) {
    console.log("[Step 6] Still on verify, waiting 30s...");
    await sleep(30000);
    url = page.url();
    await page.screenshot({ path: "E:\\API获取工具\\ZO注册\\v3_step6.png", fullPage: false });
    if (/\/dashboard|\/account|\/home|\/welcome/i.test(url)) {
      console.log("\n🎉 [SUCCESS] " + EMAIL + " registered!");
    } else {
      console.log("\n⚠️ [DONE] URL:", url);
    }
  } else {
    console.log("\n⚠️ [DONE] URL:", url);
  }
  
  browser.disconnect();
}

main().catch(e => console.error(e));
