const puppeteer = require("E:\\API获取工具\\ZO注册\\node_modules\\puppeteer-core");
const { appendFileSync } = require("fs");
async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const browser = await puppeteer.connect({ browserURL: "http://localhost:64610", timeout: 10000 });
  const page = (await browser.pages())[0];
  
  console.log("URL:", page.url());
  await page.screenshot({ path: "E:\\API获取工具\\ZO注册\\booting.png", fullPage: false });
  
  // 点 Skip 跳过个性化
  console.log("Clicking Skip...");
  await page.evaluate(() => {
    for (const el of document.querySelectorAll("button")) {
      if (el.textContent.trim() === "Skip") { el.click(); return "clicked"; }
    }
    return "not found";
  });
  
  // 等待 booting 完成
  console.log("Waiting for boot to complete...");
  for (let i = 1; i <= 30; i++) {
    await sleep(5000);
    const url = page.url();
    const body = await page.evaluate(() => document.body.innerText.substring(0, 300));
    const short = body.substring(0, 100).replace(/\n/g, " | ");
    console.log("  [" + i + "] " + url.substring(0, 60) + " | " + short);
    
    if (/dashboard|account|home|welcome|chat|settings/i.test(url) || /boot complete|your computer is ready|welcome to zo/i.test(body)) {
      console.log("\n🎉🎉🎉 REGISTERED! hilljulia5es7y81c6u8a@outlook.com");
      appendFileSync("E:\\API获取工具\\ZO注册\\results.jsonl", JSON.stringify({ email: "hilljulia5es7y81c6u8a@outlook.com", status: "success", url, time: new Date().toISOString() }) + "\n");
      await page.screenshot({ path: "E:\\API获取工具\\ZO注册\\SUCCESS.png", fullPage: false });
      browser.disconnect();
      return;
    }
  }
  
  await page.screenshot({ path: "E:\\API获取工具\\ZO注册\\boot_timeout.png", fullPage: false });
  console.log("⚠️ Boot still in progress");
  browser.disconnect();
}

main().catch(e => console.error(e));
