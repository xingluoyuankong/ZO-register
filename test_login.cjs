const puppeteer = require("E:\\API获取工具\\ZO注册\\node_modules\\puppeteer-core");
const { readFileSync } = require("fs");

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const browser = await puppeteer.connect({ browserURL: "http://localhost:9222", timeout: 10000 });
  const pages = await browser.pages();
  const page = pages[0];
  await page.setViewport({ width: 1440, height: 900 });
  
  // 读取邮箱
  const content = readFileSync("C:\\Users\\XZXyuan\\Downloads\\批量注册邮箱\\已经使用\\emma86296css4m95phvvo@outlook.com.txt", "utf-8").trim();
  const parts = content.split("----").map(s => s.trim());
  const email = parts[0];
  const password = parts[1];
  
  console.log("Email:", email);
  console.log("Password:", password.substring(0, 3) + "***");
  
  // 打开 ZO 登录页面（不是注册）
  console.log("[1] Opening login page...");
  await page.goto("https://www.zo.computer/login", { waitUntil: "networkidle2", timeout: 30000 });
  await sleep(3000);
  await page.screenshot({ path: "E:\\API获取工具\\ZO注册\\login_page.png", fullPage: false });
  
  const info = await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll("button")).map(b => b.textContent.trim().substring(0, 60));
    const inputs = Array.from(document.querySelectorAll("input")).map(i => ({ type: i.type, placeholder: i.placeholder }));
    return { buttons, inputs, url: location.href, bodyText: document.body?.innerText?.substring(0, 500) || "" };
  });
  
  console.log("URL:", info.url);
  console.log("Buttons:", JSON.stringify(info.buttons));
  console.log("Inputs:", JSON.stringify(info.inputs));
  console.log("Body:", info.bodyText);
  
  // 尝试点击 "Email me a sign-up link" 或 "Log in with email"
  const click1 = await page.evaluate(() => {
    const all = document.querySelectorAll("button, a");
    for (const el of all) {
      const t = el.textContent.trim().toLowerCase();
      if (t.includes("email") && (t.includes("log") || t.includes("sign") || t.includes("link"))) {
        el.click();
        return "Clicked: " + el.textContent.trim();
      }
    }
    return "Not found";
  });
  console.log("Click:", click1);
  
  await sleep(2000);
  await page.screenshot({ path: "E:\\API获取工具\\ZO注册\\login_after_click.png", fullPage: false });
  
  const info2 = await page.evaluate(() => {
    const inputs = Array.from(document.querySelectorAll("input")).map(i => ({ type: i.type, placeholder: i.placeholder, id: i.id }));
    const buttons = Array.from(document.querySelectorAll("button")).map(b => b.textContent.trim().substring(0, 60));
    return { inputs, buttons, bodyText: document.body?.innerText?.substring(0, 500) || "" };
  });
  
  console.log("Inputs:", JSON.stringify(info2.inputs));
  console.log("Buttons:", JSON.stringify(info2.buttons));
  console.log("Body:", info2.bodyText);
  
  browser.disconnect();
}

main().catch(e => console.error(e));
