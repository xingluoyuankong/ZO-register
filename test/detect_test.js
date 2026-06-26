// 最小 Puppeteer 测试：检测 Turnstile 是否由 CF 服务端调用
const puppeteer = require("E:\\API获取工具\\ZO注册\\node_modules\\puppeteer-core");
const { existsSync, mkdirSync, writeFileSync } = require("fs");
const { join } = require("path");

const CHROME_PATH = "C:\\Users\\XZXyuan\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe";
const CFT_PROFILE = "E:\\API获取工具\\ZO注册\\_cft_profile";

async function test(suffix, launchArgs, userDataDir) {
  console.log(`\n=== Test: ${suffix} ===`);
  
  try {
    const browser = await puppeteer.launch({
      executablePath: CHROME_PATH,
      headless: false,
      userDataDir: userDataDir || null,
      args: launchArgs,
      defaultViewport: { width: 1440, height: 900 },
      ignoreDefaultArgs: typeof launchArgs.find(a => a.includes("enable-automation")) !== "undefined" 
        ? [] 
        : ["--enable-automation"],
      timeout: 30000,
    });
    
    const page = await browser.newPage();
    
    // Navigate to ZO
    await page.goto("https://www.zo.computer/signup", { waitUntil: "domcontentloaded", timeout: 30000 });
    await new Promise(r => setTimeout(r, 3000));
    
    const info = await page.evaluate(() => {
      const iframes = document.querySelectorAll("iframe");
      const srcs = [];
      iframes.forEach(f => srcs.push(f.src?.substring(0, 80)));
      return {
        url: location.href,
        title: document.title,
        iframes: srcs,
        hasTurnstile: location.href.includes("challenges"),
        bodyStart: document.body?.innerText?.substring(0, 300),
        webdriver: navigator.webdriver,
      };
    });
    
    console.log("  Result:", JSON.stringify(info, null, 2));
    
    await browser.close();
    return info;
  } catch(e) {
    console.log("  ERROR:", e.message);
    return null;
  }
}

async function main() {
  // Test 1: Minimal args, no profile
  await test("MINIMAL_NO_PROFILE", [
    "--no-first-run",
    "--window-size=1440,900",
    "--no-sandbox",
  ], null);
  
  // Test 2: CFT profile, minimal args
  await test("CFT_PROFILE_MINIMAL", [
    "--no-first-run",
    "--window-size=1440,900",
    "--no-sandbox",
  ], CFT_PROFILE);
  
  // Test 3: Full server-like args with cft profile
  await test("CFT_FULL_SERVER_ARGS", [
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-default-apps",
    "--disable-features=Translate",
    "--disable-blink-features=AutomationControlled",
    "--window-size=1440,900",
    "--disable-save-password-bubble",
    "--disable-sync",
    "--disable-background-networking",
    "--disable-background-timer-throttling",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--no-sandbox",
    "--metrics-recording-only",
    "--no-pings",
    "--disable-infobars",
  ], CFT_PROFILE);

  console.log("\n=== All tests complete ===");
}

main().catch(e => { console.error(e); process.exit(1); });
