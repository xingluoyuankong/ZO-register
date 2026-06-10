const puppeteer = require("E:\\API获取工具\\ZO注册\\node_modules\\puppeteer-core");

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
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
  
  // 先导航到 ZO 页面
  await page.goto("https://www.zo.computer/signup", { waitUntil: "networkidle2", timeout: 30000 });
  await sleep(3000);
  console.log("On ZO page:", page.url());
  
  // 在 ZO 页面中调用 verify API（同域 + credentials）
  const token = "eyJhbGciOiJFUzI1NiIsImtpZCI6IjkxYmU5Yjk3LTMzM2ItNDQxMC04NmEwLTUyYTUyNzAwZDcxNSIsInR5cCI6IkpXVCJ9.eyJlbWFpbCI6ImVtbWE4NjI5NmNzczRtOTVwaHZ2b0BvdXRsb29rLmNvbSIsIm5vbmNlIjoiY2QxYzgzNDAtOWI1NC00YjRjLWFkN2ItMGIwOWYyMTY0OWUwIiwiZXhwIjoxNzgwNTA2NTc3LCJpc3MiOiJodHRwczovL2F1dGguem8uY29tcHV0ZXIiLCJhdWQiOiJvbi1zdWJzdHJhdGUifQ.jp4CDiOuSwYtSYcfpp0jFrxCkr1HeJ5NbZ6yVVwtxiBuhJ3iKzaSU5bt-eTjsfixKYuuR3F9bIYHrjmks8_EDw";
  
  console.log("\n[1] Calling verify API via fetch...");
  const result = await page.evaluate(async (token) => {
    try {
      const resp = await fetch("/api/email-login/verify?token=" + encodeURIComponent(token) + "&redirect=%2Fsignup", {
        method: "GET",
        credentials: "include",
        redirect: "manual"  // 不自动跟随重定向
      });
      const text = await resp.text();
      return {
        status: resp.status,
        url: resp.url,
        redirected: resp.redirected,
        headers: Object.fromEntries(resp.headers.entries()),
        bodyPreview: text.substring(0, 500)
      };
    } catch(e) {
      return { error: e.message };
    }
  }, token);
  
  console.log("Status:", result.status);
  console.log("URL:", result.url);
  console.log("Redirected:", result.redirected);
  console.log("Headers:", JSON.stringify(result.headers).substring(0, 300));
  console.log("Body:", result.bodyPreview?.substring(0, 300));
  
  // 如果返回了重定向 URL，手动导航
  if (result.status === 200 && /invalid|expired|error/i.test(result.bodyPreview || "")) {
    console.log("\n[FAIL] Token rejected by ZO");
    console.log("Reason:", result.bodyPreview?.substring(0, 200));
  } else if (result.status === 200) {
    // 可能是 HTML 页面，检查是否需要浏览器验证
    console.log("\n[2] Checking if browser verification is needed...");
    
    // 手动导航到 verify URL
    await page.evaluate((token) => {
      window.location.href = "/api/email-login/verify?token=" + encodeURIComponent(token) + "&redirect=%2Fsignup";
    }, token);
    
    await sleep(5000);
    const url = page.url();
    const body = await page.evaluate(() => document.body?.innerText?.substring(0, 500) || "");
    console.log("URL:", url);
    console.log("Body:", body.substring(0, 300));
    await page.screenshot({ path: "E:\\API获取工具\\ZO注册\\verify_result.png", fullPage: false });
    
    if (/verifying|browser check/i.test(body)) {
      console.log("\n[3] Clicking 'Continue in browser'...");
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
      
      await sleep(15000);
      const url2 = page.url();
      const body2 = await page.evaluate(() => document.body?.innerText?.substring(0, 500) || "");
      console.log("URL:", url2);
      console.log("Body:", body2.substring(0, 300));
      await page.screenshot({ path: "E:\\API获取工具\\ZO注册\\after_continue.png", fullPage: false });
      
      if (/dashboard|account|home|welcome/i.test(url2)) {
        console.log("\n🎉 [SUCCESS]!");
      } else if (/invalid|expired/i.test(body2)) {
        console.log("\n❌ [FAIL] Token expired or invalid");
      } else {
        console.log("\n⚠️ [DONE] URL:", url2);
      }
    } else if (/dashboard|account|home|welcome/i.test(url)) {
      console.log("\n🎉 [SUCCESS]!");
    }
  }
  
  browser.disconnect();
}

main().catch(e => console.error(e));
