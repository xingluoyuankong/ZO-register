const puppeteer = require("E:\\API获取工具\\ZO注册\\node_modules\\puppeteer-core");
async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const browser = await puppeteer.connect({ browserURL: "http://localhost:64610", timeout: 10000 });
  const page = (await browser.pages())[0];
  
  console.log("URL:", page.url());
  const body = await page.evaluate(() => document.body.innerText.substring(0, 500));
  console.log("Body:", body.substring(0, 300));
  await page.screenshot({ path: "E:\\API获取工具\\ZO注册\\handle_page.png", fullPage: false });

  // 点 Continue
  console.log("Clicking Continue...");
  await page.evaluate(() => {
    for (const btn of document.querySelectorAll("button")) {
      if (btn.textContent.trim() === "Continue") { btn.click(); return "clicked"; }
    }
    return "not found";
  });
  
  await sleep(8000);
  console.log("URL:", page.url());
  const body2 = await page.evaluate(() => document.body.innerText.substring(0, 300));
  console.log("Body:", body2.substring(0, 200));
  await page.screenshot({ path: "E:\\API获取工具\\ZO注册\\after_continue.png", fullPage: false });

  // 检查是否到了 dashboard
  const url = page.url();
  if (/dashboard|account|home|welcome|settings|onboarding/i.test(url)) {
    console.log("\n🎉 REGISTERED!");
  } else {
    // 可能需要再点一次或等待
    await sleep(10000);
    console.log("Final URL:", page.url());
    await page.screenshot({ path: "E:\\API获取工具\\ZO注册\\final.png", fullPage: false });
  }

  browser.disconnect();
}

main().catch(e => console.error(e));
