/**
 * 快速测试：先注册一个邮箱
 * 直接用已有 Chrome 页面
 */
const puppeteer = require("E:\\API获取工具\\ZO注册\\node_modules\\puppeteer-core");
const { readFileSync } = require("fs");

async function main() {
  const browser = await puppeteer.connect({ browserURL: "http://localhost:9222", timeout: 10000 });
  const pages = await browser.pages();
  
  console.log("Current pages:");
  for (const p of pages) {
    console.log("  " + p.url());
  }
  
  // 用已有的 about:blank 或第一个页面
  let page = pages.find(p => p.url() === "about:blank");
  if (!page) {
    // 关闭不需要的页面
    for (const p of pages) {
      if (p.url() !== "about:blank" && !p.url().includes("zo.computer")) {
        await p.close().catch(() => {});
      }
    }
    page = pages.find(p => p.url() !== "about:blank") || await browser.newPage();
  }
  
  await page.setViewport({ width: 1440, height: 900 });
  
  // 读取第一个邮箱
  const content = readFileSync("C:\\Users\\XZXyuan\\Downloads\\批量注册邮箱\\已经使用\\emma86296css4m95phvvo@outlook.com.txt", "utf-8").trim();
  const parts = content.split("----").map(s => s.trim());
  const email = parts[0];
  const clientId = parts[2];
  const refreshToken = parts[3];
  
  console.log("Using email:", email);
  
  // 1. 打开注册页
  console.log("[1/4] Opening signup page...");
  await page.goto("https://www.zo.computer/signup", { waitUntil: "networkidle2", timeout: 30000 });
  await new Promise(r => setTimeout(r, 3000));
  
  // 2. 点击 Email 按钮
  console.log("[2/4] Clicking Email button...");
  const clicked = await page.evaluate(() => {
    const buttons = document.querySelectorAll("button");
    for (const btn of buttons) {
      const directText = Array.from(btn.childNodes).filter(n => n.nodeType === 3).map(n => n.textContent.trim()).join("");
      if (directText === "Email me a sign-up link") { btn.click(); return true; }
    }
    return false;
  });
  console.log("Clicked:", clicked);
  await new Promise(r => setTimeout(r, 2000));
  
  // 3. 填写邮箱
  console.log("[3/4] Filling email...");
  await page.evaluate((email) => {
    const input = document.getElementById("email") || document.querySelector("input[type=email]");
    if (!input) return "input not found";
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(input, email);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return "filled: " + input.value;
  }, email);
  await new Promise(r => setTimeout(r, 500));
  
  // 截图
  await page.screenshot({ path: "E:\\API获取工具\\ZO注册\\test_fill.png", fullPage: false });
  
  // 4. 点击 Continue
  console.log("[4/4] Clicking Continue...");
  const contResult = await page.evaluate(() => {
    const buttons = document.querySelectorAll("button");
    for (const btn of buttons) {
      if (btn.textContent.trim() === "Continue") { btn.click(); return "clicked"; }
    }
    return "not found";
  });
  console.log("Continue:", contResult);
  await new Promise(r => setTimeout(r, 3000));
  
  await page.screenshot({ path: "E:\\API获取工具\\ZO注册\\test_after_continue.png", fullPage: false });
  
  // 获取页面文本
  const bodyText = await page.evaluate(() => document.body?.innerText?.substring(0, 500) || "");
  console.log("\nPage content:\n" + bodyText);
  
  browser.disconnect();
}

main().catch(e => console.error(e));
