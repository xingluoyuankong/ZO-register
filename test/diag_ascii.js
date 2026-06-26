const puppeteer = require("../node_modules/puppeteer-core");
const path = require("path");
const fs = require("fs");

(async () => {
  // 测试纯ASCII路径
  const EXT_DIR = "E:\\zo_ext";
  console.log("Extension path:", EXT_DIR);
  console.log("Exists:", fs.existsSync(EXT_DIR));

  const tempDir = path.join(__dirname, "..", "_test_ascii");
  if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true });

  const browser = await puppeteer.launch({
    executablePath: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    headless: false,
    args: [
      "--no-first-run", "--no-default-browser-check",
      "--disable-blink-features=AutomationControlled",
      "--no-sandbox",
      "--load-extension=" + EXT_DIR,
    ],
    ignoreDefaultArgs: ["--enable-automation"],
    userDataDir: tempDir,
  });

  const page = (await browser.pages())[0] || await browser.newPage();
  await new Promise(r => setTimeout(r, 3000));

  // 检测注入
  const r = await page.evaluate(() => ({
    cfBypass: !!window.__CF_BYPASS__,
    webdriver: navigator.webdriver,
    screenX: Object.getOwnPropertyDescriptor(MouseEvent.prototype, "screenX"),
  }));
  console.log("\n=== ASCII path test ===");
  console.log("cfBypass:", r.cfBypass);
  console.log("webdriver:", r.webdriver);
  console.log("screenX patched:", r.screenX && r.screenX.get ? "YES" : "NO");

  if (r.cfBypass) {
    console.log("[SUCCESS] Extension loaded from ASCII path!");
  } else {
    console.log("[FAIL] Extension still not loaded");
    
    // 检查 chrome://extensions
    try {
      await page.goto("edge://extensions/", { waitUntil: "domcontentloaded", timeout: 10000 });
      await new Promise(r => setTimeout(r, 2000));
      const txt = await page.evaluate(() => document.body.innerText.substring(0, 300));
      console.log("Extensions page:", txt.substring(0, 200));
    } catch(e) {}
  }

  await browser.close();
  try { fs.rmSync(tempDir, { recursive: true }); } catch(e) {}
})().catch(e => { console.error(e.message); process.exit(1); });
