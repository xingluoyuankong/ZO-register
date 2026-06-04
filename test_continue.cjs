const puppeteer = require("E:\\API获取工具\\ZO注册\\node_modules\\puppeteer-core");

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const browser = await puppeteer.connect({ browserURL: "http://localhost:9222", timeout: 10000 });
  const pages = await browser.pages();
  const page = pages[0];
  await page.setViewport({ width: 1440, height: 900 });
  
  // 当前页面应该是 ZO 的验证页面
  console.log("Current URL:", page.url());
  
  // 点击 "Continue in browser" 按钮
  console.log("[1] Clicking 'Continue in browser'...");
  const clickResult = await page.evaluate(() => {
    // 查找所有按钮和可点击元素
    const all = document.querySelectorAll("button, a, [role=button], div.clickable, span.clickable");
    const info = [];
    for (const el of all) {
      info.push(el.tagName + ": " + el.textContent.trim().substring(0, 60) + " | class=" + el.className.substring(0, 40));
      if (el.textContent.trim().toLowerCase().includes("continue")) {
        el.click();
        return "Clicked: " + el.textContent.trim() + "\nAll elements:\n" + info.join("\n");
      }
    }
    return "Not found. Elements:\n" + info.join("\n");
  });
  console.log(clickResult);
  
  await sleep(5000);
  
  const url = page.url();
  console.log("URL after click:", url);
  await page.screenshot({ path: "E:\\API获取工具\\ZO注册\\after_continue.png", fullPage: false });
  
  const bodyText = await page.evaluate(() => document.body?.innerText?.substring(0, 500) || "");
  console.log("Body:", bodyText.substring(0, 300));
  
  // 如果还是验证页面，可能需要等待更长时间
  if (/verifying|browser check/i.test(bodyText)) {
    console.log("[2] Still verifying, waiting 10s...");
    await sleep(10000);
    const url2 = page.url();
    console.log("URL after 10s:", url2);
    await page.screenshot({ path: "E:\\API获取工具\\ZO注册\\after_10s.png", fullPage: false });
    const bodyText2 = await page.evaluate(() => document.body?.innerText?.substring(0, 500) || "");
    console.log("Body:", bodyText2.substring(0, 300));
  }
  
  browser.disconnect();
}

main().catch(e => console.error(e));
