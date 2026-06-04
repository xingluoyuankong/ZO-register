const puppeteer = require("E:\\API获取工具\\ZO注册\\node_modules\\puppeteer-core");
async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const browser = await puppeteer.connect({ browserURL: "http://localhost:64610", timeout: 10000 });
  const page = (await browser.pages())[0];
  
  // 检查输入框
  const inputs = await page.evaluate(() => {
    return Array.from(document.querySelectorAll("input, textarea")).map(i => ({
      type: i.type, id: i.id, name: i.name, placeholder: i.placeholder, value: i.value,
      class: i.className.substring(0, 40)
    }));
  });
  console.log("Inputs:", JSON.stringify(inputs, null, 2));
  
  // 检查是否有 handle 输入框
  const hasHandleInput = inputs.some(i => /handle|username|name/i.test(i.id + i.name + i.placeholder));
  console.log("Has handle input:", hasHandleInput);
  
  // 如果有，填写一个随机 handle
  if (inputs.length > 0) {
    const handleInput = inputs.find(i => /handle|username|name/i.test(i.id + i.name + i.placeholder)) || inputs[0];
    console.log("Filling input:", handleInput.id || handleInput.name || handleInput.placeholder);
    
    // 生成随机 handle
    const handle = "user" + Math.random().toString(36).substring(2, 8);
    console.log("Handle:", handle);
    
    await page.evaluate((handle, inputId) => {
      const inp = inputId ? document.getElementById(inputId) : document.querySelector("input");
      if (inp) {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
        setter.call(inp, handle);
        inp.dispatchEvent(new Event("input", { bubbles: true }));
        inp.dispatchEvent(new Event("change", { bubbles: true }));
      }
    }, handle, handleInput.id);
    
    await sleep(1000);
    
    // 点 Continue
    console.log("Clicking Continue...");
    await page.evaluate(() => {
      for (const btn of document.querySelectorAll("button")) {
        if (btn.textContent.trim() === "Continue") { btn.click(); return "clicked"; }
      }
      return "not found";
    });
    
    await sleep(10000);
    console.log("URL:", page.url());
    await page.screenshot({ path: "E:\\API获取工具\\ZO注册\\after_handle.png", fullPage: false });
    const body = await page.evaluate(() => document.body.innerText.substring(0, 300));
    console.log("Body:", body.substring(0, 200));
  }
  
  browser.disconnect();
}

main().catch(e => console.error(e));
