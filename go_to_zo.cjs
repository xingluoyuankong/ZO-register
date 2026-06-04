const puppeteer = require("E:\\API获取工具\\ZO注册\\node_modules\\puppeteer-core");
const { appendFileSync } = require("fs");
async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const browser = await puppeteer.connect({ browserURL: "http://localhost:64610", timeout: 10000 });
  const page = (await browser.pages())[0];
  
  console.log("URL:", page.url());
  await page.screenshot({ path: "E:\\API获取工具\\ZO注册\\ready.png", fullPage: false });
  
  // 点 Go to your Zo
  console.log("Clicking 'Go to your Zo'...");
  await page.evaluate(() => {
    for (const el of document.querySelectorAll("button, a")) {
      if (/go to your zo/i.test(el.textContent.trim())) { el.click(); return "clicked"; }
    }
    return "not found";
  });
  
  await sleep(10000);
  console.log("URL:", page.url());
  await page.screenshot({ path: "E:\\API获取工具\\ZO注册\\dashboard.png", fullPage: false });
  const body = await page.evaluate(() => document.body.innerText.substring(0, 500));
  console.log("Body:", body.substring(0, 300));
  
  const url = page.url();
  if (/dashboard|account|home|chat|settings|app/i.test(url) || /chat|message|conversation/i.test(body)) {
    console.log("\n🎉🎉🎉 REGISTERED! hilljulia5es7y81c6u8a@outlook.com");
    appendFileSync("E:\\API获取工具\\ZO注册\\results.jsonl", JSON.stringify({ email: "hilljulia5es7y81c6u8a@outlook.com", status: "success", url, time: new Date().toISOString() }) + "\n");
  }
  
  browser.disconnect();
}

main().catch(e => console.error(e));
