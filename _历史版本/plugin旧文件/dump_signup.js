// 快速 dump ZO signup 页面结构
const puppeteer = require("puppeteer-core");
const fs = require("fs");
const os = require("os");
const path = require("path");

async function main() {
  const extDir = path.join(__dirname, "..", "turnstile-extension");
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zo_dump_"));
  const browser = await puppeteer.launch({
    executablePath: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    headless: false,
    userDataDir: tempDir,
    args: ["--no-first-run", "--no-default-browser-check", "--no-sandbox",
      "--load-extension=" + extDir, "--window-size=1440,900"],
    defaultViewport: { width: 1440, height: 900 },
    ignoreDefaultArgs: ["--enable-automation"],
  });

  const page = (await browser.pages())[0] || await browser.newPage();
  await page.goto("https://www.zo.computer/signup", { waitUntil: "domcontentloaded", timeout: 30000 });
  await new Promise(r => setTimeout(r, 3000));

  // Dump ALL buttons
  console.log("=== BUTTONS ===");
  const btns = await page.$$("button");
  for (const btn of btns) {
    const info = await btn.evaluate(e => ({
      text: e.textContent.trim().substring(0, 80),
      disabled: e.disabled,
      classes: e.className.substring(0, 80),
      visible: e.offsetParent !== null,
    })).catch(() => ({}));
    console.log(JSON.stringify(info));
  }

  // Dump ALL inputs
  console.log("\n=== INPUTS ===");
  const inputs = await page.$$("input, textarea, select");
  for (const inp of inputs) {
    const info = await inp.evaluate(e => ({
      tag: e.tagName, type: e.type, name: e.name, id: e.id,
      placeholder: e.placeholder, value: e.value,
      visible: e.offsetParent !== null,
    })).catch(() => ({}));
    console.log(JSON.stringify(info));
  }

  // Dump visible text
  console.log("\n=== PAGE TEXT (first 1000 chars) ===");
  const txt = await page.evaluate(() => document.body.innerText.substring(0, 1000));
  console.log(txt);

  // Try clicking "Email me a sign-up link" or similar
  for (const btn of btns) {
    const txt = await btn.evaluate(e => e.textContent.trim()).catch(() => "");
    if (/email|sign.?up|link|magic/i.test(txt)) {
      console.log('\nClicking: "' + txt + '"');
      await btn.click();
      await new Promise(r => setTimeout(r, 3000));
      
      // Re-dump inputs
      console.log("\n=== INPUTS AFTER CLICK ===");
      const inputs2 = await page.$$("input, textarea");
      for (const inp of inputs2) {
        const info = await inp.evaluate(e => ({
          tag: e.tagName, type: e.type, name: e.name, id: e.id,
          placeholder: e.placeholder, visible: e.offsetParent !== null,
        })).catch(() => ({}));
        console.log(JSON.stringify(info));
      }
      break;
    }
  }

  // Screenshot
  await page.screenshot({ path: path.join(__dirname, "registered", "debug_signup_page.png") });
  console.log("\nScreenshot saved to registered/debug_signup_page.png");

  await browser.close();
}

main().catch(e => { console.error(e); process.exit(1); });
