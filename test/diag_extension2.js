/**
 * 深度诊断：为什么 --load-extension 不生效
 */
const puppeteer = require("../node_modules/puppeteer-core");
const path = require("path");
const fs = require("fs");

const EXT_DIR = path.resolve(path.join(__dirname, "..", "turnstile-extension"));

(async () => {
  console.log("扩展绝对路径:", EXT_DIR);
  console.log("路径存在:", fs.existsSync(EXT_DIR));
  console.log("manifest.json 存在:", fs.existsSync(path.join(EXT_DIR, "manifest.json")));
  
  // 检查 puppeteer 版本
  const pkg = require("../node_modules/puppeteer-core/package.json");
  console.log("puppeteer-core 版本:", pkg.version);

  // 检查所有可用的浏览器
  console.log("\n=== 可用浏览器 ===");
  const browsers = [
    ["Chrome", "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"],
    ["Chrome x86", "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"],
    ["Edge", "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"],
    ["Edge x64", "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe"],
  ];
  for (const [name, p] of browsers) {
    console.log(`  ${name}: ${fs.existsSync(p) ? "EXISTS" : "NOT FOUND"} (${p})`);
  }

  // 测试1: 用 Edge + --load-extension
  console.log("\n=== 测试1: Edge + --load-extension ===");
  const edgePath = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
  const tempDir1 = path.join(__dirname, "..", "_test_profile_1");
  if (fs.existsSync(tempDir1)) fs.rmSync(tempDir1, { recursive: true });

  const browser1 = await puppeteer.launch({
    executablePath: edgePath,
    headless: false,
    args: [
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-features=Translate",
      "--disable-blink-features=AutomationControlled",
      "--no-sandbox",
      "--load-extension=" + EXT_DIR,
    ],
    ignoreDefaultArgs: ["--enable-automation"],
    userDataDir: tempDir1,
  });

  const page1 = await browser1.newPage();
  
  // 等待更长时间让扩展加载
  await new Promise(r => setTimeout(r, 3000));
  
  // 检查 about:blank 上的注入
  const result1 = await page1.evaluate(() => {
    return {
      cfBypass: window.__CF_BYPASS__,
      hasChrome: !!window.chrome,
      hasChromeRuntime: !!(window.chrome && window.chrome.runtime),
      webdriver: navigator.webdriver,
    };
  });
  console.log("about:blank 注入检测:", JSON.stringify(result1));

  // 访问 edge://extensions/ 看有没有加载
  try {
    await page1.goto("edge://extensions/", { waitUntil: "domcontentloaded", timeout: 10000 });
    await new Promise(r => setTimeout(r, 3000));
    await page1.screenshot({ path: path.join(__dirname, "debug_ext_edge.png") });
    console.log("[OK] edge://extensions/ 截图已保存");
    
    // 检查页面内容
    const extPageText = await page1.evaluate(() => document.body.innerText.substring(0, 500));
    console.log("扩展页面文字:", extPageText.substring(0, 300));
  } catch(e) {
    console.log("无法访问 edge://extensions/:", e.message.substring(0, 100));
  }

  await browser1.close();
  
  // 测试2: 检查 Edge 版本
  console.log("\n=== Edge 版本 ===");
  try {
    const edgeVersion = fs.readFileSync(
      "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.VisualElementsManifest.xml",
      "utf8"
    ).substring(0, 200);
    console.log("Edge manifest:", edgeVersion);
  } catch(e) {}
  
  try {
    const { execSync } = require("child_process");
    const ver = execSync('"C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe" --version', { encoding: "utf8" });
    console.log("Edge 版本:", ver.trim());
  } catch(e) {
    console.log("无法获取 Edge 版本");
  }

  // 清理
  try { fs.rmSync(tempDir1, { recursive: true }); } catch(e) {}

  console.log("\n=== 诊断完成 ===");
})().catch(e => {
  console.error("[FATAL]", e.message, e.stack);
  process.exit(1);
});
