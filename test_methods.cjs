const puppeteer = require("E:\\API获取工具\\ZO注册\\node_modules\\puppeteer-core");

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const browser = await puppeteer.connect({ browserURL: "http://localhost:9222", timeout: 10000 });
  const pages = await browser.pages();
  const page = pages[0];
  await page.setViewport({ width: 1440, height: 900 });
  
  // 最新的 ZO 魔法链接（16:49:43 发送的，有效期到 17:09:37）
  const magicLink = "https://www.zo.computer/api/email-login/verify?redirect=%2Fsignup&token=eyJhbGciOiJIUzI1NiIsImtpZCI6IjkxYmU5Yjk3LTMzM2ItNDQxMC04NmEwLTUyYTUyNzAwZDcxNSIsInR5cCI6IkpXVCJ9.eyJlbWFpbCI6ImVtbWE4NjI5NmNzczRtOTVwaHZ2b0BvdXRsb29rLmNvbSIsIm5vbmNlIjoiY2QxYzgzNDAtOWI1NC00YjRjLWFkN2ItMGIwOWYyMTY0OWUwIiwiZXhwIjoxNzgwNTA2NTc3LCJpc3MiOiJodHRwczovL2F1dGguem8uY29tcHV0ZXIiLCJhdWQiOiJvbi1zdWJzdHJhdGUifQ.jp4CDiOuSwYtSYcfpp0jFrxCkr1HeJ5NbZ6yVVwtxiBuhJ3iKzaSU5bt-eTjsfixKYuuR3F9bIYHrjmks8_EDw";
  
  console.log("Current URL:", page.url());
  
  // 方法1: page.goto
  console.log("\n=== Method 1: page.goto ===");
  await page.goto(magicLink, { waitUntil: "domcontentloaded", timeout: 30000 });
  await sleep(3000);
  let url = page.url();
  let body = await page.evaluate(() => document.body?.innerText?.substring(0, 300) || "");
  console.log("URL:", url);
  console.log("Body:", body.substring(0, 200));
  await page.screenshot({ path: "E:\\API获取工具\\ZO注册\\m1_goto.png", fullPage: false });
  
  // 检查是否成功
  if (/dashboard|account|home|welcome/i.test(url)) {
    console.log("[SUCCESS] Method 1 works!");
    browser.disconnect();
    return;
  }
  
  // 方法2: window.location.href
  console.log("\n=== Method 2: window.location.href ===");
  await page.goto("about:blank", { timeout: 10000 });
  await sleep(1000);
  await page.evaluate((link) => { window.location.href = link; }, magicLink);
  await sleep(5000);
  url = page.url();
  body = await page.evaluate(() => document.body?.innerText?.substring(0, 300) || "");
  console.log("URL:", url);
  console.log("Body:", body.substring(0, 200));
  await page.screenshot({ path: "E:\\API获取工具\\ZO注册\\m2_location.png", fullPage: false });
  
  if (/dashboard|account|home|welcome/i.test(url)) {
    console.log("[SUCCESS] Method 2 works!");
    browser.disconnect();
    return;
  }
  
  // 方法3: 在 ZO 页面中打开（同域）
  console.log("\n=== Method 3: Same-origin navigation ===");
  await page.goto("https://www.zo.computer/signup", { waitUntil: "networkidle2", timeout: 30000 });
  await sleep(3000);
  console.log("On ZO page:", page.url());
  
  // 在 ZO 页面中执行 fetch 调用 verify API
  console.log("Fetching verify API...");
  const verifyResult = await page.evaluate(async (link) => {
    try {
      const resp = await fetch(link, { redirect: "follow" });
      return { status: resp.status, url: resp.url, text: await resp.text() };
    } catch(e) {
      return { error: e.message };
    }
  }, magicLink);
  console.log("Verify result:", JSON.stringify(verifyResult).substring(0, 300));
  
  // 方法4: 用 form 提交
  console.log("\n=== Method 4: Form submit ===");
  await page.goto("https://www.zo.computer/signup", { waitUntil: "networkidle2", timeout: 30000 });
  await sleep(3000);
  
  // 提取 token 和 redirect
  const token = magicLink.match(/token=([^&]+)/)[1];
  const redirect = magicLink.match(/redirect=([^&]+)/)[1];
  
  // 创建 form 并提交
  const formResult = await page.evaluate((token, redirect) => {
    const form = document.createElement("form");
    form.method = "POST";
    form.action = "/api/email-login/verify";
    
    const tokenInput = document.createElement("input");
    tokenInput.name = "token";
    tokenInput.value = token;
    form.appendChild(tokenInput);
    
    const redirectInput = document.createElement("input");
    redirectInput.name = "redirect";
    redirectInput.value = redirect;
    form.appendChild(redirectInput);
    
    document.body.appendChild(form);
    form.submit();
    return "submitted";
  }, token, decodeURIComponent(redirect));
  console.log("Form result:", formResult);
  await sleep(5000);
  url = page.url();
  body = await page.evaluate(() => document.body?.innerText?.substring(0, 300) || "");
  console.log("URL:", url);
  console.log("Body:", body.substring(0, 200));
  await page.screenshot({ path: "E:\\API获取工具\\ZO注册\\m4_form.png", fullPage: false });
  
  // 方法5: 直接 fetch verify 并检查响应
  console.log("\n=== Method 5: Direct fetch verify ===");
  const directResult = await page.evaluate(async (token) => {
    try {
      const resp = await fetch("https://www.zo.computer/api/email-login/verify?token=" + encodeURIComponent(token) + "redirect=%2Fsignup", {
        method: "GET",
        credentials: "include"
      });
      const text = await resp.text();
      return { status: resp.status, url: resp.url, bodyPreview: text.substring(0, 500) };
    } catch(e) {
      return { error: e.message };
    }
  }, token);
  console.log("Direct result:", JSON.stringify(directResult).substring(0, 400));
  
  browser.disconnect();
}

main().catch(e => console.error(e));
