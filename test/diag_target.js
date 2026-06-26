const puppeteer = require("../node_modules/puppeteer-core");
const path = require("path");
const fs = require("fs");

const SCRIPT_JS = fs.readFileSync(path.join(__dirname, "..", "turnstile-extension", "script.js"), "utf8");

(async () => {
  console.log("script.js:", SCRIPT_JS.length, "bytes");

  const tempDir = path.join(__dirname, "..", "_test_target");
  if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true });

  const browser = await puppeteer.launch({
    executablePath: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    headless: false,
    args: [
      "--no-first-run", "--no-default-browser-check",
      "--disable-blink-features=AutomationControlled", "--no-sandbox",
    ],
    ignoreDefaultArgs: ["--enable-automation"],
    userDataDir: tempDir,
  });

  const page = (await browser.pages())[0] || await browser.newPage();

  // === 方法: 用 CDP Target 域自动 attach 到每个 iframe ===
  const cdp = await page.createCDPSession();
  
  // 自动 attach 到所有新 target（包括 iframe）
  await cdp.send("Target.setAutoAttach", {
    autoAttach: true,
    waitForDebuggerOnStart: true,  // 关键！在 target 启动时暂停，等我们注入
    flatten: true,
  });

  // 当新 target（iframe）出现时，注入 bypass 脚本
  cdp.on("Target.attachedToTarget", async (event) => {
    const { sessionId, targetInfo } = event;
    console.log("[TARGET] attached:", targetInfo.type, targetInfo.url ? targetInfo.url.substring(0, 80) : "");
    
    if (targetInfo.type === "iframe") {
      try {
        // 通过 sessionId 向这个 iframe 的 target 发送注入命令
        await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
          source: SCRIPT_JS,
        }, sessionId);
        console.log("[INJECT] bypass 注入到 iframe:", targetInfo.url.substring(0, 60));
      } catch(e) {
        console.log("[INJECT] 注入失败:", e.message.substring(0, 80));
      }
    }
    
    // 恢复 target 执行
    try {
      await cdp.send("Runtime.runIfWaitingForDebugger", {}, sessionId);
    } catch(e) {}
  });

  // 主 frame 注入
  await page.evaluateOnNewDocument(SCRIPT_JS);

  // 监听 frame 事件
  page.on("frameattached", (f) => console.log("[FRAME] attached:", f.url().substring(0, 80)));
  page.on("framenavigated", (f) => {
    if (f !== page.mainFrame()) {
      console.log("[FRAME] navigated:", f.url().substring(0, 80));
    }
  });

  // 打开 ZO 注册页
  console.log("\n打开注册页...");
  await page.goto("https://zo.computer/signup", { waitUntil: "networkidle2", timeout: 30000 });
  console.log("URL:", page.url());

  // 检查主 frame
  const mainCheck = await page.evaluate(() => ({
    cfBypass: !!window.__CF_BYPASS__,
    screenX: Object.getOwnPropertyDescriptor(MouseEvent.prototype, "screenX")?.get ? "PATCHED" : "ORIGINAL",
  }));
  console.log("主frame:", JSON.stringify(mainCheck));

  // 等待 iframe
  console.log("\n等待 iframe...");
  for (let i = 0; i < 10; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const frames = page.frames().filter(f => f !== page.mainFrame());
    if (frames.length > 0) {
      console.log(`发现 ${frames.length} 个 iframe`);
      for (const f of frames) {
        console.log("  URL:", f.url().substring(0, 100));
        try {
          const check = await f.evaluate(() => ({
            cfBypass: !!window.__CF_BYPASS__,
            screenX: Object.getOwnPropertyDescriptor(MouseEvent.prototype, "screenX")?.get ? "PATCHED" : "ORIGINAL",
          }));
          console.log("  注入状态:", JSON.stringify(check));
        } catch(e) {
          console.log("  [X]", e.message.substring(0, 60));
        }
      }
    } else {
      console.log(`[${(i+1)*2}s] 无 iframe`);
    }
  }

  await page.screenshot({ path: path.join(__dirname, "debug_target_test.png") });
  await browser.close();
  try { fs.rmSync(tempDir, { recursive: true }); } catch(e) {}
  console.log("\n完成");
})().catch(e => { console.error("[FATAL]", e.message, e.stack); process.exit(1); });
