const puppeteer = require("puppeteer-core");
const { join } = require("path");
const fs = require("fs");

const extDir = join(__dirname, "..", "turnstile-extension");
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const bypassJs = fs.readFileSync(join(extDir, "script.js"), "utf8");

(async () => {
  const browser = await puppeteer.launch({
    executablePath: EDGE,
    headless: false,
    userDataDir: join(__dirname, "..", "temp_solve_test"),
    args: [
      "--no-first-run", "--no-default-browser-check", "--no-sandbox",
      "--disable-blink-features=AutomationControlled",
      "--load-extension=" + extDir,
    ],
    ignoreDefaultArgs: ["--enable-automation"],
    enableExtensions: true,
  });

  const page = (await browser.pages())[0] || await browser.newPage();
  await page.evaluateOnNewDocument(bypassJs);

  // Also inject via framenavigated for iframe
  page.on("framenavigated", async (frame) => {
    if (frame === page.mainFrame()) return;
    try { await frame.evaluate(bypassJs); } catch(e) {}
  });

  const testPagePath = "file:///" + join(__dirname, "turnstile_test.html").replace(/\\/g, "/");
  await page.goto(testPagePath, { waitUntil: "networkidle2", timeout: 30000 });
  
  console.log("Page loaded. Monitoring Turnstile state...");

  // Poll for 60 seconds
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 3000));
    
    // Check main frame for token
    const state = await page.evaluate(() => {
      const input = document.querySelector('input[name="cf-turnstile-response"]');
      const token = input ? input.value : "";
      const widget = document.querySelector('.cf-turnstile');
      const widgetText = widget ? widget.innerText : "";
      return {
        tokenLen: token.length,
        widgetText: widgetText.substring(0, 100),
        hasCheckbox: !!document.querySelector('iframe'),
      };
    }).catch(() => ({}));

    // Check iframe for bypass
    let iframeState = "no_iframe";
    const frames = page.frames();
    for (const f of frames) {
      if (f.url().includes("challenges.cloudflare")) {
        try {
          iframeState = JSON.stringify(await f.evaluate(() => ({
            bypass: !!window.__CF_BYPASS__,
            webdriver: navigator.webdriver,
          })));
        } catch(e) {
          iframeState = "access_denied";
        }
      }
    }

    console.log("[" + ((i+1)*3) + "s] token=" + state.tokenLen + " iframe=" + iframeState + " widget=" + (state.widgetText || "").substring(0, 50));
    
    if (state.tokenLen > 0) {
      console.log("\n✅ TURNSTILE SOLVED! Token length: " + state.tokenLen);
      break;
    }
    
    await page.screenshot({ path: "debug_solve_" + i + ".png" });
  }

  await browser.close();
})();
