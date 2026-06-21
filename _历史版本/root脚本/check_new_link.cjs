const puppeteer = require("E:\\API获取工具\\ZO注册\\node_modules\\puppeteer-core");

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const browser = await puppeteer.connect({ browserURL: "http://localhost:9222", timeout: 10000 });
  const pages = await browser.pages();
  const page = pages[0];
  await page.setViewport({ width: 1440, height: 900 });
  
  // 打开新的注册链接
  console.log("Opening: https://zo-computer.cello.so/MptyFaIB9Xx");
  await page.goto("https://zo-computer.cello.so/MptyFaIB9Xx", { waitUntil: "networkidle2", timeout: 30000 });
  await sleep(5000);
  
  const url = page.url();
  console.log("URL:", url);
  await page.screenshot({ path: "E:\\API获取工具\\ZO注册\\new_link.png", fullPage: false });
  
  // 获取页面内容
  const info = await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll("button, a, [role=button]")).map(b => ({
      tag: b.tagName, text: b.textContent.trim().substring(0, 80), class: b.className.substring(0, 40)
    }));
    const inputs = Array.from(document.querySelectorAll("input")).map(i => ({
      type: i.type, placeholder: i.placeholder, id: i.id
    }));
    return { buttons, inputs, bodyText: document.body?.innerText?.substring(0, 800) || "", title: document.title };
  });
  
  console.log("Title:", info.title);
  console.log("\nButtons:");
  for (const b of info.buttons) console.log("  " + b.tag + ": " + b.text);
  console.log("\nInputs:");
  for (const i of info.inputs) console.log("  " + i.type + " | " + i.placeholder + " | id=" + i.id);
  console.log("\nBody:\n" + info.bodyText.substring(0, 500));
  
  browser.disconnect();
}

main().catch(e => console.error(e));
