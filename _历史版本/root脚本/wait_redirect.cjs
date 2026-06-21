const puppeteer = require("E:\\API获取工具\\ZO注册\\node_modules\\puppeteer-core");

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const browser = await puppeteer.connect({ browserURL: "http://localhost:9222", timeout: 10000 });
  const pages = await browser.pages();
  const page = pages[0];
  await page.setViewport({ width: 1440, height: 900 });
  
  // 当前页面应该是 ZO 的 Redirecting 页面
  console.log("URL:", page.url());
  
  // 持续等待直到跳转完成
  for (let i = 1; i <= 20; i++) {
    await sleep(5000);
    const url = page.url();
    const bodyText = await page.evaluate(() => document.body?.innerText?.substring(0, 300) || "");
    console.log("[#" + i + "] URL: " + url);
    console.log("  Body: " + bodyText.substring(0, 150));
    
    if (/\/dashboard|\/account|\/home|\/welcome|\/settings|\/onboarding/i.test(url)) {
      console.log("\n🎉 [SUCCESS] Registration complete!");
      await page.screenshot({ path: "E:\\API获取工具\\ZO注册\\SUCCESS.png", fullPage: false });
      browser.disconnect();
      return;
    }
    
    if (/error|expired|invalid|something went wrong/i.test(bodyText)) {
      console.log("\n❌ [FAIL] Error detected");
      await page.screenshot({ path: "E:\\API获取工具\\ZO注册\\FAIL.png", fullPage: false });
      browser.disconnect();
      return;
    }
    
    // 如果还在 redirecting 页面，继续等
    if (/redirecting|hang tight|finish signing/i.test(bodyText)) {
      console.log("  Still redirecting, waiting...");
    }
  }
  
  console.log("\n⚠️ Timeout. Final URL:", page.url());
  await page.screenshot({ path: "E:\\API获取工具\\ZO注册\\TIMEOUT.png", fullPage: false });
  browser.disconnect();
}

main().catch(e => console.error(e));
