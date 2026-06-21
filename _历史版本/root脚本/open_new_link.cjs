const puppeteer = require("E:\\API获取工具\\ZO注册\\node_modules\\puppeteer-core");
const { readFileSync } = require("fs");

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const browser = await puppeteer.connect({ browserURL: "http://localhost:9222", timeout: 10000 });
  const pages = await browser.pages();
  const page = pages[0];
  await page.setViewport({ width: 1440, height: 900 });

  console.log("Opening: https://zo-computer.cello.so/XczDkTYgFpn");
  await page.goto("https://zo-computer.cello.so/XczDkTYgFpn", { waitUntil: "networkidle2", timeout: 30000 });
  await sleep(5000);

  const url = page.url();
  console.log("URL:", url);
  await page.screenshot({ path: "E:\\API获取工具\\ZO注册\\new_reg_1.png", fullPage: false });

  const info = await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll("button, a, [role=button]")).map(b => ({
      tag: b.tagName, text: b.textContent.trim().substring(0, 100), class: b.className.substring(0, 60)
    }));
    const inputs = Array.from(document.querySelectorAll("input")).map(i => ({
      type: i.type, placeholder: i.placeholder, id: i.id, name: i.name
    }));
    return { buttons, inputs, bodyText: document.body?.innerText?.substring(0, 1500) || "", title: document.title };
  });

  console.log("Title:", info.title);
  console.log("\nButtons:");
  for (const b of info.buttons) console.log("  [" + b.tag + "] " + b.text);
  console.log("\nInputs:");
  for (const i of info.inputs) console.log("  " + i.type + " | placeholder=" + i.placeholder + " | id=" + i.id + " | name=" + i.name);
  console.log("\nBody:\n" + info.bodyText.substring(0, 800));

  browser.disconnect();
}

main().catch(e => console.error(e));
