const puppeteer = require("E:\\API获取工具\\ZO注册\\node_modules\\puppeteer-core");
const { readFileSync } = require("fs");

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const browser = await puppeteer.connect({ browserURL: "http://localhost:9222", timeout: 10000 });
  const pages = await browser.pages();
  const page = pages[0];
  await page.setViewport({ width: 1440, height: 900 });
  
  // 读取 emma86296 的凭证
  const content = readFileSync("C:\\Users\\XZXyuan\\Downloads\\批量注册邮箱\\已经使用\\emma86296css4m95phvvo@outlook.com.txt", "utf-8").trim();
  const parts = content.split("----").map(s => s.trim());
  const email = parts[0];
  const password = parts[1];
  const clientId = parts[2];
  const refreshToken = parts[3];
  
  console.log("Email:", email);
  
  // 方法：直接用密码登录（不走魔法链接）
  // 先打开 ZO 登录页
  console.log("[1] Opening ZO login page...");
  await page.goto("https://www.zo.computer/login", { waitUntil: "networkidle2", timeout: 30000 });
  await sleep(3000);
  await page.screenshot({ path: "E:\\API获取工具\\ZO注册\\login_page.png", fullPage: false });
  
  // 看看有什么按钮
  const btnInfo = await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll("button, a")).map(b => b.textContent.trim().substring(0, 60));
    const inputs = Array.from(document.querySelectorAll("input")).map(i => ({ type: i.type, placeholder: i.placeholder }));
    return { buttons, inputs, bodyText: document.body?.innerText?.substring(0, 600) || "" };
  });
  console.log("Buttons:", JSON.stringify(btnInfo.buttons));
  console.log("Inputs:", JSON.stringify(btnInfo.inputs));
  console.log("Body:", btnInfo.bodyText.substring(0, 300));
  
  // 点击 "Email me a sign-up link" 或类似的
  console.log("[2] Clicking email login...");
  const click1 = await page.evaluate(() => {
    const all = document.querySelectorAll("button, a");
    for (const el of all) {
      const t = el.textContent.trim().toLowerCase();
      if (t.includes("email") && (t.includes("log") || t.includes("sign") || t.includes("link"))) {
        el.click();
        return "Clicked: " + el.textContent.trim();
      }
    }
    // 也试试直接用 "Log in with email"
    for (const el of all) {
      if (el.textContent.trim() === "Log in with email") {
        el.click();
        return "Clicked Log in with email";
      }
    }
    return "Not found";
  });
  console.log("Click:", click1);
  await sleep(2000);
  
  // 看看出现什么输入框
  const afterInfo = await page.evaluate(() => {
    const inputs = Array.from(document.querySelectorAll("input")).map(i => ({ type: i.type, placeholder: i.placeholder, id: i.id }));
    const buttons = Array.from(document.querySelectorAll("button")).map(b => b.textContent.trim().substring(0, 60));
    return { inputs, buttons, bodyText: document.body?.innerText?.substring(0, 600) || "" };
  });
  console.log("After click - Inputs:", JSON.stringify(afterInfo.inputs));
  console.log("After click - Buttons:", JSON.stringify(afterInfo.buttons));
  console.log("Body:", afterInfo.bodyText.substring(0, 300));
  
  // Step 1: 填写邮箱
  console.log("[3] Filling email...");
  await page.evaluate((email) => {
    const input = document.getElementById("email") || document.querySelector("input[type=email]");
    if (!input) return "input not found";
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(input, email);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return "filled";
  }, email);
  await sleep(500);
  
  // 点击 Continue / Next
  console.log("[4] Clicking Continue...");
  const click2 = await page.evaluate(() => {
    const buttons = document.querySelectorAll("button");
    for (const btn of buttons) {
      const t = btn.textContent.trim();
      if (t === "Continue" || t === "Next" || t === "Send" || t === "Log in") {
        btn.click();
        return "Clicked: " + t;
      }
    }
    return "Not found";
  });
  console.log("Continue:", click2);
  await sleep(3000);
  
  // 截图看看
  await page.screenshot({ path: "E:\\API获取工具\\ZO注册\\after_email_submit.png", fullPage: false });
  const step2Info = await page.evaluate(() => {
    const inputs = Array.from(document.querySelectorAll("input")).map(i => ({ type: i.type, placeholder: i.placeholder, id: i.id }));
    const buttons = Array.from(document.querySelectorAll("button")).map(b => b.textContent.trim().substring(0, 60));
    return { inputs, buttons, bodyText: document.body?.innerText?.substring(0, 600) || "" };
  });
  console.log("Step 2 - Inputs:", JSON.stringify(step2Info.inputs));
  console.log("Step 2 - Buttons:", JSON.stringify(step2Info.buttons));
  console.log("Body:", step2Info.bodyText.substring(0, 300));
  
  // 检查是否出现了密码输入框
  const hasPassword = step2Info.inputs.some(i => i.type === "password");
  if (hasPassword) {
    console.log("[5] Password input found! Filling password...");
    await page.evaluate((password) => {
      const input = document.querySelector("input[type=password]");
      if (!input) return "password input not found";
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(input, password);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      return "password filled";
    }, password);
    await sleep(500);
    
    // 点击登录按钮
    console.log("[6] Clicking login...");
    const click3 = await page.evaluate(() => {
      const buttons = document.querySelectorAll("button");
      for (const btn of buttons) {
        const t = btn.textContent.trim();
        if (t === "Log in" || t === "Sign in" || t === "Continue" || t === "Log In") {
          btn.click();
          return "Clicked: " + t;
        }
      }
      return "Not found";
    });
    console.log("Login:", click3);
    await sleep(5000);
    
    await page.screenshot({ path: "E:\\API获取工具\\ZO注册\\after_login.png", fullPage: false });
    const afterLogin = await page.evaluate(() => ({
      url: location.href,
      bodyText: document.body?.innerText?.substring(0, 500) || ""
    }));
    console.log("URL after login:", afterLogin.url);
    console.log("Body:", afterLogin.bodyText.substring(0, 300));
    
    if (/\/dashboard|\/account|\/home|\/welcome/i.test(afterLogin.url)) {
      console.log("\n[SUCCESS] Registered with password!");
    } else if (/verifying|browser check/i.test(afterLogin.bodyText)) {
      console.log("[WAIT] Browser verification required");
      
      // 点击 Continue in browser
      await page.evaluate(() => {
        const all = document.querySelectorAll("button, a, div, span");
        for (const el of all) {
          if (el.textContent.trim() === "Continue in browser") {
            el.click();
            return "clicked";
          }
        }
        return "not found";
      });
      await sleep(10000);
      const url2 = page.url();
      console.log("URL after browser check:", url2);
      await page.screenshot({ path: "E:\\API获取工具\\ZO注册\\after_browser_check.png", fullPage: false });
    }
  } else {
    // 可能还是需要等邮件
    console.log("[WAIT] No password field yet. Waiting for magic link...");
    
    // 在 Outlook 中搜索 ZO 邮件
    const CLIENT_ID = clientId;
    const REFRESH_TOKEN = refreshToken;
    
    for (let attempt = 1; attempt <= 30; attempt++) {
      const body = new URLSearchParams({
        client_id: CLIENT_ID, grant_type: "refresh_token", refresh_token: REFRESH_TOKEN,
        scope: "https://graph.microsoft.com/.default offline_access",
      });
      const resp = await fetch("https://login.microsoftonline.com/consumers/oauth2/v2.0/token", {
        method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: body.toString(),
      });
      const data = await resp.json();
      
      const mailResp = await fetch(
        "https://graph.microsoft.com/v1.0/me/messages?$top=5&$select=subject,from,body,receivedDateTime&$orderby=receivedDateTime%20desc",
        { headers: { Authorization: "Bearer " + data.access_token } }
      );
      const mail = await mailResp.json();
      
      for (const msg of (mail.value || [])) {
        const body = msg.body || {};
        const htmlBody = (body.contentType === "html" && body.content) || "";
        const textBody = (body.contentType === "text" && body.content) || "";
        const combined = (msg.subject || "") + " " + textBody + " " + htmlBody;
        
        const links = combined.match(/https?:\/\/[^\s"'<>\]]*(?:zo\.computer|zocomputer|cello\.so)[^\s"'<>\]]*/gi) || [];
        for (let link of links) {
          link = link.replace(/[)\]>,;:.!?]+$/, "").replace(/&amp;/g, "&");
          if (link.includes("/api/email-login/verify")) {
            console.log("\n[FOUND] Attempt " + attempt + ": " + link.substring(0, 120));
            
            // 打开链接
            await page.goto(link, { waitUntil: "domcontentloaded", timeout: 30000 });
            await sleep(5000);
            
            const url = page.url();
            console.log("URL:", url);
            await page.screenshot({ path: "E:\\API获取工具\\ZO注册\\magic_link_opened.png", fullPage: false });
            
            if (/verifying|browser check/i.test(url + " " + (await page.evaluate(() => document.body?.innerText || "")))) {
              console.log("Browser verification needed, clicking Continue...");
              await page.evaluate(() => {
                const all = document.querySelectorAll("*");
                for (const el of all) {
                  if (el.textContent.trim() === "Continue in browser" && el.children.length === 0) {
                    el.click();
                    return "clicked";
                  }
                }
                return "not found";
              });
              await sleep(10000);
              const url2 = page.url();
              console.log("URL after browser check:", url2);
            }
            
            browser.disconnect();
            return;
          }
        }
      }
      
      process.stdout.write(".");
      await sleep(5000);
    }
  }
  
  browser.disconnect();
}

main().catch(e => console.error(e));
