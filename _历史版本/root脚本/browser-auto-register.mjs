/**
 * ZO 浏览器注册 - 通过浏览器自动化完成整个注册流程
 * 1. 打开 ZO 注册页面
 * 2. 点击 "Email me a sign-up link"
 * 3. 填写邮箱，点击 Continue
 * 4. 等待邮件到达（通过 Graph API 轮询）
 * 5. 在浏览器中打开魔法链接完成注册
 */

import { readFileSync, readdirSync } from "fs";
import { join } from "path";

const EMAIL_DIR = "C:\\Users\\XZXyuan\\Downloads\\批量注册邮箱\\已经使用";

function parseEmailFile(filePath) {
  const content = readFileSync(filePath, "utf-8").trim();
  const parts = content.split("----").map(s => s.trim());
  if (parts.length < 4) return null;
  return { email: parts[0], password: parts[1], clientId: parts[2], refreshToken: parts[3] };
}

function loadAccounts() {
  return readdirSync(EMAIL_DIR)
    .filter(f => f.endsWith(".txt") && !f.startsWith("tokens_") && !f.includes("combo"))
    .map(f => parseEmailFile(join(EMAIL_DIR, f)))
    .filter(a => a && a.email && a.refreshToken);
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const puppeteer = require("E:\\API获取工具\\ZO注册\\node_modules\\puppeteer-core");
  
  console.log("[1/5] Connecting to browser...");
  const browser = await puppeteer.connect({ browserURL: "http://localhost:9222", timeout: 5000 });
  const context = await browser.createIncognitoBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  
  // Load first account
  const accounts = loadAccounts();
  if (accounts.length === 0) { console.log("No accounts!"); process.exit(1); }
  const account = accounts[0];
  console.log("[OK] Using: " + account.email);
  
  try {
    // Step 1: Open ZO signup page
    console.log("[2/5] Opening ZO signup page...");
    await page.goto("https://www.zo.computer/signup", { waitUntil: "networkidle2", timeout: 30000 });
    await sleep(2000);
    
    // Screenshot
    await page.screenshot({ path: "E:\\API获取工具\\ZO注册\\step1_signup.png", fullPage: false });
    console.log("[OK] Signup page loaded");
    
    // Step 2: Click "Email me a sign-up link"
    console.log("[3/5] Clicking 'Email me a sign-up link'...");
    const clicked = await page.evaluate(() => {
      const buttons = document.querySelectorAll("button");
      for (const btn of buttons) {
        if (btn.textContent.includes("Email me a sign-up link") || btn.textContent.includes("Email")) {
          btn.click();
          return true;
        }
      }
      return false;
    });
    
    if (!clicked) {
      // 可能需要先点击某个区域
      console.log("[WARN] Direct button click failed, trying alternative...");
      await page.evaluate(() => {
        // 查找所有可点击元素
        const all = document.querySelectorAll("button, a, [role=button], div[class*=email], span[class*=email]");
        for (const el of all) {
          const text = el.textContent.trim();
          if (text.toLowerCase().includes("email") && text.length < 50) {
            el.click();
            return text;
          }
        }
        return null;
      });
    }
    
    await sleep(2000);
    await page.screenshot({ path: "E:\\API获取工具\\ZO注册\\step2_after_click.png", fullPage: false });
    
    // Step 3: Fill email and click Continue
    console.log("[4/5] Filling email...");
    const emailFilled = await page.evaluate((email) => {
      const input = document.querySelector("input[type=email], input[placeholder*=email], input[placeholder*=Email], input[name*=email], input");
      if (input) {
        // 模拟 React 输入
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        nativeInputValueSetter.call(input, email);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }
      return false;
    }, account.email);
    
    console.log("Email filled: " + emailFilled);
    await sleep(500);
    
    // Click Continue/Send button
    const continueClicked = await page.evaluate(() => {
      const buttons = document.querySelectorAll("button");
      for (const btn of buttons) {
        const text = btn.textContent.trim().toLowerCase();
        if (text === "continue" || text === "send" || text === "send link" || text === "submit") {
          btn.click();
          return btn.textContent.trim();
        }
      }
      // 如果没有 Continue，看看所有按钮
      const allBtns = [];
      buttons.forEach(b => allBtns.push(b.textContent.trim()));
      return "Buttons: " + allBtns.join(" | ");
    });
    console.log("Continue result: " + continueClicked);
    
    await sleep(3000);
    await page.screenshot({ path: "E:\\API获取工具\\ZO注册\\step3_after_continue.png", fullPage: false });
    
    // Step 4: Wait for magic link email
    console.log("[5/5] Waiting for magic link email...");
    
    // Refresh token
    const tokenBody = new URLSearchParams({
      client_id: account.clientId,
      grant_type: "refresh_token",
      refresh_token: account.refreshToken,
      scope: "https://graph.microsoft.com/.default offline_access",
    });
    
    const tokenResp = await fetch("https://login.microsoftonline.com/consumers/oauth2/v2.0/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: tokenBody.toString(),
    });
    
    const tokenData = await tokenResp.json();
    const accessToken = tokenData.access_token;
    
    let magicLink = null;
    for (let attempt = 1; attempt <= 30; attempt++) {
      try {
        const mailResp = await fetch(
          "https://graph.microsoft.com/v1.0/me/messages?$top=15&$select=id,subject,from,body,bodyPreview,receivedDateTime&$orderby=receivedDateTime%20desc",
          { headers: { Authorization: "Bearer " + accessToken } }
        );
        
        const mail = await mailResp.json();
        const messages = mail.value || [];
        
        for (const msg of messages) {
          const subject = msg.subject || "";
          const preview = msg.bodyPreview || "";
          const body = msg.body || {};
          const htmlBody = (body.contentType === "html" && body.content) || "";
          const textBody = (body.contentType === "text" && body.content) || "";
          const combined = subject + " " + preview + " " + textBody + " " + htmlBody;
          
          if (/zo\.computer|zocomputer|cello\.so/i.test(combined)) {
            const links = combined.match(/https?:\/\/[^\s"'<>\]]*(?:zo\.computer|zocomputer|cello\.so)[^\s"'<>\]]*/gi) || [];
            if (links.length > 0) {
              magicLink = links[0].replace(/[)\]>,;:.!?]+$/, "");
              console.log("[OK] Magic link found (attempt " + attempt + ")!");
              console.log("  Subject: " + subject);
              console.log("  Link: " + magicLink.substring(0, 120));
              break;
            }
          }
        }
        
        if (magicLink) break;
        
        process.stdout.write(".");
        await sleep(5000);
      } catch (err) {
        console.log("[WARN] " + err.message);
        await sleep(5000);
      }
    }
    
    if (!magicLink) {
      console.log("\n[FAIL] Magic link not found after 30 attempts");
      await page.screenshot({ path: "E:\\API获取工具\\ZO注册\\step4_no_link.png", fullPage: false });
      await context.close();
      process.exit(1);
    }
    
    // Step 5: Open magic link in browser
    console.log("\n[5/5] Opening magic link in browser...");
    await page.goto(magicLink, { waitUntil: "domcontentloaded", timeout: 30000 });
    await sleep(3000);
    
    const finalUrl = page.url();
    console.log("Final URL: " + finalUrl);
    await page.screenshot({ path: "E:\\API获取工具\\ZO注册\\step5_final.png", fullPage: false });
    
    await sleep(5000);
    const laterUrl = page.url();
    console.log("URL after 5s: " + laterUrl);
    await page.screenshot({ path: "E:\\API获取工具\\ZO注册\\step5_after5s.png", fullPage: false });
    
    if (/\/dashboard|\/account|\/home|\/welcome/i.test(laterUrl)) {
      console.log("\n[SUCCESS] Registration complete!");
    } else {
      console.log("\n[DONE] Check screenshots");
    }
    
    await context.close();
    
  } catch (err) {
    console.error("[ERROR] " + err.message);
    await page.screenshot({ path: "E:\\API获取工具\\ZO注册\\error.png", fullPage: false }).catch(() => {});
    await context.close();
  }
}

main().catch(e => { console.error("Fatal:", e); process.exit(1); });
