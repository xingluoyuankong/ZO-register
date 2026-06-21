const PUPPETEER_URL = "file:///E:/API获取工具/ZO注册/node_modules/puppeteer-core/lib/puppeteer/index.js";

async function main() {
  const puppeteer = await import(PUPPETEER_URL);
  
  const browser = await puppeteer.connect({ browserURL: "http://localhost:9222", timeout: 5000 });
  const context = await browser.createIncognitoBrowserContext();
  const page = await context.newPage();
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
    return { buttons, inputs, url: location.href, title: document.title, bodyText: document.body?.innerText?.substring(0, 600) || "" };
  });
  
  console.log("URL:", info.url);
  console.log("Title:", info.title);
  console.log("Buttons:", JSON.stringify(info.buttons, null, 2));
  console.log("Inputs:", JSON.stringify(info.inputs, null, 2));
  console.log("Body:\n" + info.bodyText);
  
  // Click Email button
  const clickResult = await page.evaluate(() => {
    const all = document.querySelectorAll("button, a, [role=button]");
    for (const el of all) {
      const t = el.textContent.trim().toLowerCase();
      if (t.includes("email") && (t.includes("sign") || t.includes("link") || t.includes("signup"))) {
        el.click(); return "Clicked: " + el.textContent.trim();
      }
    }
    return "Not found";
  });
  console.log("\nClick:", clickResult);
  
  await new Promise(r => setTimeout(r, 2000));
  await page.screenshot({ path: "E:\\API获取工具\\ZO注册\\probe_2_after.png", fullPage: false });
  
  const info2 = await page.evaluate(() => {
    const inputs = Array.from(document.querySelectorAll("input")).map(i => ({
      type: i.type, placeholder: i.placeholder, name: i.name,
    }));
    const buttons = Array.from(document.querySelectorAll("button")).map(b => ({
      text: b.textContent.trim().substring(0, 80),
    }));
    return { inputs, buttons, url: location.href, bodyText: document.body?.innerText?.substring(0, 600) || "" };
  });
  
  console.log("\nAfter click - URL:", info2.url);
  console.log("Inputs:", JSON.stringify(info2.inputs, null, 2));
  console.log("Buttons:", JSON.stringify(info2.buttons, null, 2));
  console.log("Body:\n" + info2.bodyText);
  
  await context.close();
}

main().catch(e => console.error(e));
