const puppeteer = require("E:\\API获取工具\\ZO注册\\node_modules\\puppeteer-core");

async function main() {
  try {
    const browser = await puppeteer.connect({ browserURL: "http://localhost:9222", timeout: 10000 });
    
    console.log("Connected!");
    const pages = await browser.pages();
    console.log("Pages:", pages.length);
    
    // 用一个已有页面或者创建新的
    let page = pages.find(p => p.url() === "about:blank") || pages[0];
    if (!page) {
      page = await browser.newPage();
    }
    
    await page.setViewport({ width: 1440, height: 900 });
    await page.goto("https://www.zo.computer/signup", { waitUntil: "networkidle2", timeout: 30000 });
    await new Promise(r => setTimeout(r, 3000));
    
    await page.screenshot({ path: "E:\\API获取工具\\ZO注册\\probe_1_signup.png", fullPage: false });
    
    const info = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll("button")).map(b => ({
        text: b.textContent.trim().substring(0, 80),
        class: b.className.substring(0, 80),
      }));
      const inputs = Array.from(document.querySelectorAll("input")).map(i => ({
        type: i.type, placeholder: i.placeholder, name: i.name,
      }));
      return { buttons, inputs, url: location.href, title: document.title, bodyText: document.body?.innerText?.substring(0, 800) || "" };
    });
    
    console.log("URL:", info.url);
    console.log("Title:", info.title);
    console.log("Buttons:", JSON.stringify(info.buttons, null, 2));
    console.log("Inputs:", JSON.stringify(info.inputs, null, 2));
    console.log("\nBody:\n" + info.bodyText);
    
    // Click "Email me a sign-up link"
    const clickResult = await page.evaluate(() => {
      // 查找所有按钮
      const all = document.querySelectorAll("button, a, [role=button], div");
      for (const el of all) {
        const t = el.textContent.trim();
        if (t.toLowerCase() === "email me a sign-up link" || 
            (t.toLowerCase().includes("email") && t.toLowerCase().includes("sign"))) {
          el.click();
          return "Clicked: " + t;
        }
      }
      return "Not found";
    });
    console.log("\nClick result:", clickResult);
    
    await new Promise(r => setTimeout(r, 2000));
    await page.screenshot({ path: "E:\\API获取工具\\ZO注册\\probe_2_after_click.png", fullPage: false });
    
    const info2 = await page.evaluate(() => {
      const inputs = Array.from(document.querySelectorAll("input")).map(i => ({
        type: i.type, placeholder: i.placeholder, name: i.name, id: i.id,
      }));
      const buttons = Array.from(document.querySelectorAll("button")).map(b => ({
        text: b.textContent.trim().substring(0, 80),
      }));
      return { inputs, buttons, url: location.href, bodyText: document.body?.innerText?.substring(0, 800) || "" };
    });
    
    console.log("\nAfter click - URL:", info2.url);
    console.log("Inputs:", JSON.stringify(info2.inputs, null, 2));
    console.log("Buttons:", JSON.stringify(info2.buttons, null, 2));
    console.log("\nBody:\n" + info2.bodyText);
    
    browser.disconnect();
  } catch(e) {
    console.error("Error:", e.message);
  }
}

main();
