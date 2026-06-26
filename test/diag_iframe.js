const puppeteer = require("../node_modules/puppeteer-core");
const path = require("path");
const fs = require("fs");

const SCRIPT_JS = fs.readFileSync(path.join(__dirname, "..", "turnstile-extension", "script.js"), "utf8");

(async () => {
  const tempDir = path.join(__dirname, "..", "_test_turnstile");
  if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true });

  const browser = await puppeteer.launch({
    executablePath: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    headless: false,
    args: ["--no-first-run", "--no-default-browser-check", "--disable-blink-features=AutomationControlled", "--no-sandbox"],
    ignoreDefaultArgs: ["--enable-automation"],
    userDataDir: tempDir,
  });

  const page = (await browser.pages())[0] || await browser.newPage();

  // CDP Target auto-attach
  const cdp = await page.createCDPSession();
  await cdp.send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });

  cdp.on("Target.attachedToTarget", async (event) => {
    const { sessionId, targetInfo } = event;
    console.log("[TARGET]", targetInfo.type, (targetInfo.url || "").substring(0, 80));
    if (targetInfo.type === "iframe") {
      try {
        // 用 sessionId 参数注入到该 iframe
        await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: SCRIPT_JS }, sessionId);
        console.log("[INJECT] bypass → iframe OK");
      } catch(e) {
        console.log("[INJECT] fail:", e.message.substring(0, 60));
      }
    }
    try { await cdp.send("Runtime.runIfWaitingForDebugger", {}, sessionId); } catch(e) {}
  });

  await page.evaluateOnNewDocument(SCRIPT_JS);

  page.on("framenavigated", async (frame) => {
    if (frame === page.mainFrame()) return;
    console.log("[FRAMENAV]", frame.url().substring(0, 80));
    try { await frame.evaluate(SCRIPT_JS); console.log("[FRAMENAV] injected OK"); } catch(e) {}
  });

  // 访问一个有 Turnstile 的真实页面
  // Cloudflare 的 Turnstile demo 页面
  console.log("打开 Cloudflare Turnstile demo...");
  await page.goto("https://demats.github.io/cf-turnstile-demo/", { waitUntil: "networkidle2", timeout: 30000 }).catch(async () => {
    // fallback: 用 ZO 的登录页（它会显示 Turnstile）
    console.log("demo 页不可用，尝试 ZO login...");
    await page.goto("https://zo.computer/login", { waitUntil: "networkidle2", timeout: 30000 });
  });

  console.log("URL:", page.url());
  await new Promise(r => setTimeout(r, 3000));

  // 检查所有 frames
  const allFrames = page.frames();
  console.log("\n=== Frames 总数:", allFrames.length, "===");
  
  for (const f of allFrames) {
    const url = f.url();
    console.log("\nFrame:", url.substring(0, 100));
    if (f === page.mainFrame()) {
      const check = await f.evaluate(() => ({
        cfBypass: !!window.__CF_BYPASS__,
        screenX: Object.getOwnPropertyDescriptor(MouseEvent.prototype, "screenX")?.get ? "PATCHED" : "ORIGINAL",
      }));
      console.log("  →", JSON.stringify(check));
    } else {
      try {
        const check = await f.evaluate(() => ({
          cfBypass: !!window.__CF_BYPASS__,
          screenX: Object.getOwnPropertyDescriptor(MouseEvent.prototype, "screenX")?.get ? "PATCHED" : "ORIGINAL",
        }));
        console.log("  →", JSON.stringify(check));
        if (check.cfBypass && check.screenX === "PATCHED") {
          console.log("  ★★★ IFRAME 注入成功! ★★★");
        }
      } catch(e) {
        console.log("  [X] cross-origin:", e.message.substring(0, 60));
      }
    }
  }

  await page.screenshot({ path: path.join(__dirname, "debug_turnstile_iframe.png") });
  await browser.close();
  try { fs.rmSync(tempDir, { recursive: true }); } catch(e) {}
  console.log("\n完成");
})().catch(e => { console.error("[FATAL]", e.message); process.exit(1); });
