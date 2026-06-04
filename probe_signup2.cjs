const puppeteer = require("E:\\API获取工具\\ZO注册\\node_modules\\puppeteer-core");

async function main() {
  try {
    const browser = await puppeteer.connect({ browserURL: "http://localhost:9222", timeout: 10000 });
    const pages = await browser.pages();
    const page = pages[0];
    await page.setViewport({ width: 1440, height: 900 });
    
    // 打开注册页
    await page.goto("https://www.zo.computer/signup", { waitUntil: "networkidle2", timeout: 30000 });
    await new Promise(r => setTimeout(r, 3000));
    
    // 分析按钮的详细结构
    const btnInfo = await page.evaluate(() => {
      const buttons = document.querySelectorAll("button");
      return Array.from(buttons).map(b => ({
        text: b.textContent.trim(),
        outerHTML: b.outerHTML.substring(0, 500),
        rect: b.getBoundingClientRect(),
      }));
    });
    
    console.log("=== BUTTONS ===");
    for (const b of btnInfo) {
      console.log("Text:", b.text);
      console.log("HTML:", b.outerHTML);
      console.log("Rect:", JSON.stringify(b.rect));
      console.log("");
    }
    
    // 用精确的文本匹配点击 "Email me a sign-up link"
    const clickResult = await page.evaluate(() => {
      const buttons = document.querySelectorAll("button");
      for (const btn of buttons) {
        // 精确匹配按钮文本
        const directText = Array.from(btn.childNodes).filter(n => n.nodeType === 3).map(n => n.textContent.trim()).join("");
        if (directText === "Email me a sign-up link") {
          btn.click();
          return "Clicked by direct text: " + btn.textContent.trim();
        }
      }
      // fallback: 用 innerText 精确匹配
      for (const btn of buttons) {
        if (btn.textContent.trim() === "Email me a sign-up link") {
          btn.click();
          return "Clicked by innerText";
        }
      }
      return "Not found";
    });
    console.log("Click result:", clickResult);
    
    await new Promise(r => setTimeout(r, 2000));
    
    // 检查是否出现邮箱输入框
    const afterInfo = await page.evaluate(() => {
      const inputs = document.querySelectorAll("input");
      const info = Array.from(inputs).map(i => ({
        type: i.type, placeholder: i.placeholder, name: i.name, id: i.id,
        class: i.className.substring(0, 80),
      }));
      const buttons = Array.from(document.querySelectorAll("button")).map(b => b.textContent.trim().substring(0, 60));
      return { inputs: info, buttons, bodyText: document.body?.innerText?.substring(0, 800) || "" };
    });
    
    console.log("\n=== AFTER CLICK ===");
    console.log("Inputs:", JSON.stringify(afterInfo.inputs, null, 2));
    console.log("Buttons:", JSON.stringify(afterInfo.buttons, null, 2));
    console.log("Body:\n" + afterInfo.bodyText);
    
    await page.screenshot({ path: "E:\\API获取工具\\ZO注册\\probe_3_after_precise.png", fullPage: false });
    
    browser.disconnect();
  } catch(e) {
    console.error("Error:", e.message);
  }
}

main();
