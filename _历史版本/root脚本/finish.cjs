const puppeteer = require("E:\\API获取工具\\ZO注册\\node_modules\\puppeteer-core");
async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const browser = await puppeteer.connect({ browserURL: "http://localhost:64610", timeout: 10000 });
  const page = (await browser.pages())[0];
  console.log("URL:", page.url());
  
  // 点 Go to your Zo
  const clicked = await page.evaluate(() => {
    for (const el of document.querySelectorAll("button, a, div, span")) {
      if (/go to your zo/i.test(el.textContent.trim()) && el.children.length === 0) {
        el.click();
        return el.tagName + ": " + el.textContent.trim();
      }
    }
    return "not found";
  });
  console.log("Clicked:", clicked);
  
  await sleep(10000);
  console.log("URL:", page.url());
  await page.screenshot({ path: "E:\\API获取工具\\ZO注册\\final_zo.png", fullPage: false });
  const body = await page.evaluate(() => document.body.innerText.substring(0, 500));
  console.log("Body:", body.substring(0, 300));
  browser.disconnect();
}
main().catch(e => console.error(e));
