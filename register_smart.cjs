/**
 * ZO 注册 - 智能等待 Turnstile 完成
 * 
 * 关键改进：不急着点 "Continue in browser"，先等 Turnstile 完成
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

  console.log("=== ZO Registration (Smart Turnstile) ===");
  console.log("Email:", EMAIL);

  const browser = await puppeteer.connect({ browserURL: "http://localhost:9222", timeout: 10000 });
  const pages = await browser.pages();
  const page = pages[0];
  await page.setViewport({ width: 1440, height: 900 });

  // Step 1: 注入反检测脚本 + Turnstile 绕过补丁
  console.log("\n[0/5] Injecting anti-detection + Turnstile patch...");
  await page.evaluateOnNewDocument(() => {
    // ★ Cloudflare Turnstile 绕过：劫持 screenX/screenY
    if (!window.__TURNSTILE_PATCHED__) {
      window.__TURNSTILE_PATCHED__ = true;
      var _offX = Math.floor(Math.random() * 121) + 80;
      var _offY = Math.floor(Math.random() * 91) + 60;
      try { Object.defineProperty(MouseEvent.prototype, 'screenX', { get: function() { return (this.clientX||0) + _offX; }, configurable: true }); } catch(e) {}
      try { Object.defineProperty(MouseEvent.prototype, 'screenY', { get: function() { return (this.clientY||0) + _offY; }, configurable: true }); } catch(e) {}
      try { Object.defineProperty(PointerEvent.prototype, 'screenX', { get: function() { return (this.clientX||0) + _offX; }, configurable: true }); } catch(e) {}
      try { Object.defineProperty(PointerEvent.prototype, 'screenY', { get: function() { return (this.clientY||0) + _offY; }, configurable: true }); } catch(e) {}
    }
    // 隐藏 webdriver 标志
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    // 伪造 plugins
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
    // 伪造 languages
    Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
  });

  // Step 2: 打开注册页
  console.log("[1/5] Opening signup...");
  await page.goto("https://www.zo.computer/signup", { waitUntil: "networkidle2", timeout: 30000 });
  await sleep(3000);

  // Step 3: 点击 "Email me a sign-up link" 并填写邮箱
  console.log("[2/5] Filling email...");
  await page.evaluate(() => {
    const buttons = document.querySelectorAll("button");
    for (const btn of buttons) {
      const directText = Array.from(btn.childNodes).filter(n => n.nodeType === 3).map(n => n.textContent.trim()).join("");
      if (directText === "Email me a sign-up link") { btn.click(); return true; }
    }
    return false;
  });
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
  const sendTime = new Date();
  console.log("[OK] Email sent at " + sendTime.toISOString());

  // Step 4: 等待魔法链接
  console.log("[3/5] Waiting for magic link...");
  const { link, newRefreshToken } = await waitForLink(CLIENT_ID, REFRESH_TOKEN, sendTime);
  console.log("\n[OK] Found: " + link.substring(0, 80));

  if (newRefreshToken !== REFRESH_TOKEN) {
    const newContent = [EMAIL, PASSWORD, CLIENT_ID, newRefreshToken].join("----");
    writeFileSync("C:\\Users\\XZXyuan\\Downloads\\批量注册邮箱\\已经使用\\hilljulia5es7y81c6u8a@outlook.com.txt", newContent, "utf-8");
    console.log("  Token refreshed");
  }

  // Step 5: 打开魔法链接
  console.log("[4/5] Opening magic link...");
  await page.goto(link, { waitUntil: "networkidle2", timeout: 30000 });
  await sleep(5000);

  let url = page.url();
  let bodyText = await page.evaluate(() => document.body?.innerText?.substring(0, 500) || "");
  console.log("URL:", url);
  console.log("Body:", bodyText.substring(0, 200));

  // Step 6: 智能等待 Turnstile 完成
  console.log("[5/5] Waiting for Turnstile to complete...");
  
  // 检查 Turnstile hidden input 是否被填充
  for (let i = 1; i <= 20; i++) {
    const turnstileState = await page.evaluate(() => {
      // ★ 主动通过 turnstile API 获取令牌
      try {
        if (typeof turnstile !== 'undefined') {
          const res = turnstile.getResponse();
          if (res) {
            const input = document.querySelector('input[name="cf-turnstile-response"]');
            if (input) {
              const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
              setter.call(input, res);
              input.dispatchEvent(new Event('change', { bubbles: true }));
            }
            return { gotToken: true, tokenLen: res.length };
          }
          // 尝试 reset
          try { turnstile.reset(); } catch(e) {}
        }
      } catch (e) {}

      // 查找所有可能的 Turnstile 响应输入
      const inputs = document.querySelectorAll('input[name*="cf"], input[name*="turnstile"], input[type="hidden"]');
      const values = {};
      for (const inp of inputs) {
        if (inp.name && inp.value) values[inp.name] = inp.value.substring(0, 50);
      }
      
      // 检查 iframe 中的 Turnstile
      const iframes = document.querySelectorAll('iframe');
      const iframeInfo = Array.from(iframes).map(f => ({ src: f.src?.substring(0, 80), id: f.id }));
      
      // 检查页面状态
      const body = document.body?.innerText?.substring(0, 300) || "";
      const isVerifying = /verifying|browser check/i.test(body);
      const isRedirecting = /redirecting|hang tight/i.test(body);
      const isInvalid = /invalid|expired/i.test(body);
      
      return { gotToken: false, values, iframeInfo, isVerifying, isRedirecting, isInvalid };
    });

    console.log("[#" + i + "] Turnstile inputs:", JSON.stringify(turnstileState.values));
    if (turnstileState.iframeInfo.length > 0) console.log("  Iframes:", JSON.stringify(turnstileState.iframeInfo));
    console.log("  Verifying=" + turnstileState.isVerifying + " Redirecting=" + turnstileState.isRedirecting + " Invalid=" + turnstileState.isInvalid);

    // 如果已经跳转或过期，停止等待
    if (turnstileState.isRedirecting || turnstileState.isInvalid) break;

    // ★ 如果通过 turnstile API 直接获取到了令牌
    if (turnstileState.gotToken) {
      console.log("  [Turnstile] Token obtained via API! len=" + turnstileState.tokenLen);
    }

    // 如果 Turnstile 响应已填充，点击 Continue
    const hasResponse = turnstileState.gotToken || Object.values(turnstileState.values).some(v => v && v.length > 10);
    if (hasResponse) {
      console.log("  Turnstile response detected! Clicking Continue...");
      await page.evaluate(() => {
        const all = document.querySelectorAll("button, a, div, span");
        for (const el of all) {
          if (el.textContent.trim() === "Continue in browser") { el.click(); return; }
        }
      });
      await sleep(5000);
      break;
    }
    
    // 每 3 秒尝试点击一次 "Continue in browser"
    if (i % 2 === 0) {
      console.log("  Clicking 'Continue in browser'...");
      await page.evaluate(() => {
        const all = document.querySelectorAll("button, a, div, span");
        for (const el of all) {
          if (el.textContent.trim() === "Continue in browser") { el.click(); return; }
        }
      });
    }
    
    await sleep(3000);
  }

  // 最终检查
  await sleep(10000);
  url = page.url();
  bodyText = await page.evaluate(() => document.body?.innerText?.substring(0, 500) || "");
  console.log("\nFinal URL:", url);
  console.log("Final Body:", bodyText.substring(0, 300));
  await page.screenshot({ path: "E:\\API获取工具\\ZO注册\\smart_final.png", fullPage: false });

  const isDashboard = /\/dashboard|\/account|\/home|\/welcome|\/settings|\/onboarding/i.test(url);
  const isError = /invalid|expired|something went wrong/i.test(bodyText);

  if (isDashboard) {
    console.log("\n🎉 [SUCCESS] " + EMAIL + " registered!");
    appendFileSync("E:\\API获取工具\\ZO注册\\results.jsonl", JSON.stringify({ email: EMAIL, status: "success", url, time: new Date().toISOString() }) + "\n");
  } else if (isError) {
    console.log("\n❌ [FAIL] " + bodyText.substring(0, 200));
    appendFileSync("E:\\API获取工具\\ZO注册\\results.jsonl", JSON.stringify({ email: EMAIL, status: "fail", time: new Date().toISOString() }) + "\n");
  } else {
    // 等待更长时间
    console.log("\n⏳ Waiting 30s more...");
    await sleep(30000);
    url = page.url();
    await page.screenshot({ path: "E:\\API获取工具\\ZO注册\\smart_wait.png", fullPage: false });
    if (/\/dashboard|\/account|\/home|\/welcome/i.test(url)) {
      console.log("🎉 [SUCCESS] " + EMAIL + " registered!");
      appendFileSync("E:\\API获取工具\\ZO注册\\results.jsonl", JSON.stringify({ email: EMAIL, status: "success", url, time: new Date().toISOString() }) + "\n");
    } else {
      console.log("⚠️ [DONE] URL:", url);
      appendFileSync("E:\\API获取工具\\ZO注册\\results.jsonl", JSON.stringify({ email: EMAIL, status: "unknown", url, time: new Date().toISOString() }) + "\n");
    }
  }

  browser.disconnect();
}

main().catch(e => console.error(e));
