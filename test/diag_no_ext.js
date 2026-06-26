const puppeteer = require("puppeteer-core");
const { join } = require("path");
const fs = require("fs");

const bypassJs = fs.readFileSync(join(__dirname, "..", "turnstile-extension", "script.js"), "utf8");
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";

(async () => {
  // NO extension at all — only evaluateOnNewDocument + framenavigated
  const browser = await puppeteer.launch({
    executablePath: EDGE,
    headless: false,
    userDataDir: join(__dirname, "..", "temp_no_ext"),
    args: [
      "--no-first-run", "--no-default-browser-check", "--no-sandbox",
      "--disable-blink-features=AutomationControlled",
    ],
    ignoreDefaultArgs: ["--enable-automation"],
    // NO enableExtensions — no extension loaded
  });

  const page = (await browser.pages())[0] || await browser.newPage();
  
  // Layer 1: evaluateOnNewDocument
  await page.evaluateOnNewDocument(bypassJs);
  console.log("[setup] evaluateOnNewDocument active");

  // Layer 2: framenavigated for iframe injection
  page.on("framenavigated", async (frame) => {
    if (frame === page.mainFrame()) return;
    try {
      await frame.evaluate(bypassJs);
      console.log("[framenavigated] bypass injected into: " + frame.url().substring(0, 60));
    } catch(e) {
      console.log("[framenavigated] FAILED: " + e.message.substring(0, 50));
    }
  });

  const testPagePath = "file:///" + join(__dirname, "turnstile_test.html").replace(/\\/g, "/");
  await page.goto(testPagePath, { waitUntil: "networkidle2", timeout: 30000 });
  await new Promise(r => setTimeout(r, 3000));

  // Check all frames
  const frames = page.frames();
  console.log("\n=== Frames: " + frames.length + " ===");
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    try {
      const check = await f.evaluate(() => ({
        bypass: !!window.__CF_BYPASS__,
        webdriver: navigator.webdriver,
        screenX: window.screenX,
      }));
      console.log("[" + i + "] " + f.url().substring(0, 70) + " => " + JSON.stringify(check));
    } catch(e) {
      console.log("[" + i + "] " + f.url().substring(0, 70) + " => DENIED");
    }
  }

  // Poll for token (60s)
  console.log("\n=== Polling for token (60s) ===");
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 3000));
    const tokenLen = await page.evaluate(() => {
      const input = document.querySelector('input[name="cf-turnstile-response"]');
      return input ? input.value.length : 0;
    }).catch(() => -1);
    
    console.log("[" + ((i+1)*3) + "s] token=" + tokenLen);
    
    if (tokenLen > 0) {
      console.log("\n✅ SOLVED WITHOUT EXTENSION! Token: " + tokenLen + " chars");
      await page.screenshot({ path: "debug_no_ext_solved.png" });
      break;
    }
  }

  await page.screenshot({ path: "debug_no_ext_final.png" });
  await browser.close();
})();
