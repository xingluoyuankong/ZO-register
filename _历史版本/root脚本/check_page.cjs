const puppeteer = require("E:\\API获取工具\\ZO注册\\node_modules\\puppeteer-core");

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const browser = await puppeteer.connect({ browserURL: "http://localhost:9222", timeout: 10000 });
  const pages = await browser.pages();
  const page = pages[0];
  await page.setViewport({ width: 1440, height: 900 });
  
  const url = page.url();
  console.log("URL:", url);
  
  // 获取页面完整内容
  const info = await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll("button, a, [role=button]")).map(b => ({
      tag: b.tagName,
      text: b.textContent.trim().substring(0, 80),
      class: b.className.substring(0, 60),
      href: b.href || ""
    }));
    const inputs = Array.from(document.querySelectorAll("input")).map(i => ({
      type: i.type, placeholder: i.placeholder, id: i.id, value: i.value
    }));
    const bodyText = document.body?.innerText?.substring(0, 1000) || "";
    const title = document.title;
    return { buttons, inputs, bodyText, title };
  });
  
  console.log("Title:", info.title);
  console.log("\nButtons:");
  for (const b of info.buttons) {
    console.log("  " + b.tag + ": " + b.text + " | class=" + b.class + " | href=" + b.href);
  }
  console.log("\nInputs:");
  for (const i of info.inputs) {
    console.log("  " + i.type + " | placeholder=" + i.placeholder + " | id=" + i.id + " | value=" + i.value);
  }
  console.log("\nBody:\n" + info.bodyText.substring(0, 500));
  
  // 检查页面上是否有 "Continue" 或 "Get Started" 按钮
  const hasContinue = info.buttons.some(b => /continue|get started|start|sign up|log in/i.test(b.text));
  if (hasContinue) {
    console.log("\n[ACTION] Found action button, clicking...");
    await page.evaluate(() => {
      const all = document.querySelectorAll("button, a, [role=button]");
      for (const el of all) {
        const t = el.textContent.trim().toLowerCase();
        if (t.includes("continue") || t.includes("get started") || t.includes("start") || t.includes("sign up")) {
          el.click();
          return "Clicked: " + el.textContent.trim();
        }
      }
      return "Not found";
    });
    await sleep(10000);
    const url2 = page.url();
    console.log("URL after click:", url2);
    await page.screenshot({ path: "E:\\API获取工具\\ZO注册\\after_click.png", fullPage: false });
    const body2 = await page.evaluate(() => document.body?.innerText?.substring(0, 500) || "");
    console.log("Body:", body2.substring(0, 300));
  }
  
  // 检查是否有 WebSocket 或网络请求
  console.log("\n[NETWORK] Checking for WebSocket connections...");
  const wsInfo = await page.evaluate(() => {
    // 检查是否有活跃的请求
    return {
      cookies: document.cookie.substring(0, 300),
      localStorage: Object.keys(localStorage).join(", "),
      sessionStorage: Object.keys(sessionStorage).join(", ")
    };
  });
  console.log("Cookies:", wsInfo.cookies);
  console.log("localStorage:", wsInfo.localStorage);
  console.log("sessionStorage:", wsInfo.sessionStorage);
  
  browser.disconnect();
}

main().catch(e => console.error(e));
