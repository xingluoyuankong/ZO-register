// 最小化 Puppeteer 测试 — 截图 Turnstile 页面
const puppeteer = require("puppeteer");
const { join } = require("path");
const { writeFileSync } = require("fs");

const CHROME_PATH = "C:\\Users\\XZXyuan\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe";
const CFT_PROFILE = "E:\\API获取工具\\ZO注册\\_cft_profile";

// Magic link (fresh, need to get from email)
const MAGIC_LINK = process.argv[2] || "";

async function getMagicLink() {
  const imaps = require("imap-simple");
  const { simpleParser } = require("mailparser");
  
  const conn = new imaps({
    imap: {
      user: "hendricktamm95v80awzaxli@outlook.com",
      password: "Xxzvh@2026Secure#",
      host: "outlook.office365.com",
      port: 993,
      tls: true,
      authTimeout: 30000,
    }
  });
  
  await conn.openBox("INBOX");
  const msgs = await conn.search(["ALL"], { bodies: [""], markSeen: false });
  const latest = msgs.slice(-5);
  
  for (const msg of latest.reverse()) {
    const full = await simpleParser(msg.parts[0].body);
    const combined = (full.text || "") + " " + (full.html || "");
    if (/zo/i.test(combined) && /no-reply@zocomputer\.com/i.test(full.from?.valueOf?.() || full.from?.text || "")) {
      const m = combined.match(/https:\/\/www\.zocomputer\.com\/api\/email-login\/verify\?[^\s"']+/i);
      if (m) {
        console.log("Found magic link:", m[0].substring(0, 80) + "...");
        return m[0];
      }
    }
  }
  throw new Error("No magic link found");
}

async function main() {
  const magicLink = MAGIC_LINK || await getMagicLink();
  
  console.log("Launching Chrome with minimal flags...");
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: false,
    userDataDir: CFT_PROFILE,
    args: [
      "--no-first-run",
      "--window-size=1440,900",
      "--disable-sync",
      "--no-sandbox",
      "--disable-gpu",
      "--disable-dev-shm-usage",
    ],
    defaultViewport: { width: 1440, height: 900 },
    ignoreDefaultArgs: ["--enable-automation"],
  });
  
  console.log("Chrome launched. Opening magic link...");
  const page = await browser.newPage();
  
  // Navigate to magic link
  await page.goto(magicLink, { waitUntil: "networkidle2", timeout: 60000 });
  await new Promise(r => setTimeout(r, 5000));
  
  console.log("Page loaded. Taking screenshot...");
  await page.screenshot({ path: join(__dirname, "turnstile_page.png"), fullPage: true });
  
  // Check DOM for iframes
  const iframeInfo = await page.evaluate(() => {
    const allIframes = document.querySelectorAll("iframe");
    const results = [];
    allIframes.forEach((f, i) => {
      results.push({
        index: i,
        src: f.src,
        id: f.id,
        className: f.className,
        width: f.offsetWidth,
        height: f.offsetHeight,
        visible: f.offsetParent !== null,
      });
    });
    return {
      count: allIframes.length,
      iframes: results,
      bodyText: document.body.innerText.substring(0, 500),
      url: window.location.href,
    };
  });
  
  console.log("DOM info:", JSON.stringify(iframeInfo, null, 2));
  console.log("Screenshot saved: turnstile_page.png");
  
  // Keep browser open
  console.log("Browser remains open for inspection. Press Ctrl+C to close.");
  await new Promise(r => setTimeout(r, 300000));
}

main().catch(e => { console.error("Error:", e); process.exit(1); });
