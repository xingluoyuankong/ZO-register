const puppeteer = require("puppeteer-core");
const { join } = require("path");

const extDir = join(__dirname, "..", "turnstile-extension");
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";

(async () => {
  console.log("=== Testing with enableExtensions: true ===");
  const browser = await puppeteer.launch({
    executablePath: EDGE,
    headless: false,
    userDataDir: join(__dirname, "..", "temp_diag_ext"),
    args: [
      "--no-first-run", "--no-default-browser-check",
      "--no-sandbox", "--load-extension=" + extDir,
    ],
    ignoreDefaultArgs: ["--enable-automation"],
    enableExtensions: true,
  });

  const page = await browser.newPage();
  await page.goto("chrome://extensions/", { waitUntil: "domcontentloaded", timeout: 15000 });
  await new Promise(r => setTimeout(r, 2000));
  await page.screenshot({ path: "debug_ext_enabled.png", fullPage: true });
  
  // Check if extension is listed
  const extName = await page.evaluate(() => {
    return document.body.innerText;
  });
  
  const hasExtension = extName.includes("Turnstile");
  console.log("Extension visible:", hasExtension);
  console.log("Page text (first 500):", extName.substring(0, 500));

  // Test on actual page with Turnstile
  if (hasExtension) {
    console.log("\n--- Testing on real page ---");
    const testPage = await browser.newPage();
    await testPage.goto("https://zo.computer/register", { waitUntil: "domcontentloaded", timeout: 30000 });
    await new Promise(r => setTimeout(r, 3000));
    
    const bypassCheck = await testPage.evaluate(() => {
      return {
        cfBypass: !!window.__CF_BYPASS__,
        screenX: window.screenX,
        screenY: window.screenY,
      };
    });
    console.log("Bypass check:", JSON.stringify(bypassCheck));
  }

  await browser.close();
  console.log("\n=== DONE ===");
})();
