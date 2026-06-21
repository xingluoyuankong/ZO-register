/**
 * dump_cookies.js — 导出 ZO 所有 cookies
 */
const puppeteer = require("puppeteer-core");
const path = require("path");
const fs = require("fs");

const COOKIE_AT = "eyJhbGciOiJFUzI1NiIsImtpZCI6IjkxYmU5Yjk3LTMzM2ItNDQxMC04NmEwLTUyYTUyNzAwZDcxNSIsInR5cCI6IkpXVCJ9.eyJtb2RlIjoiYWNjZXNzIiwidHlwZSI6InVzZXIiLCJwcm9wZXJ0aWVzIjp7ImlkIjoidXNyXzFQSWh0dlZMSUZpZlRWeTciLCJmdWxsX25hbWUiOiJhZGF2aXN2Z2t4bWRwYWMxYWY5cmNuIiwiZW1haWwiOiJhZGF2aXN2Z2t4bWRwYWMxYWY5cmNuQG91dGxvb2suY29tIiwiZG9tYWlucyI6WyJhZGF2aXN2ZyJdfSwiYXVkIjoib24tc3Vic3RyYXRlIiwiaXNzIjoiaHR0cHM6Ly9hdXRoLnpvLmNvbXB1dGVyIiwic3ViIjoidXNyXzFQSWh0dlZMSUZpZlRWeTciLCJleHAiOjE3ODQ2Mzg3NjB9.MFMGYy2tLuKuwX2VRYG8uCIBgUDK3P2aIZ7H3roy-vDR4-GlxBHE198CgmmTQkxKsfJGnvEkAO75_-pvg4AcRA";
const EXT_PATH = path.join("E:\\API获取工具\\ZO注册", "turnstile-extension");

async function main() {
  const browser = await puppeteer.launch({
    executablePath: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    headless: false,
    args: ["--no-sandbox", `--load-extension=${EXT_PATH}`, "--disable-blink-features=AutomationControlled"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.setCookie({ name: "access_token", value: COOKIE_AT, domain: ".zo.computer", path: "/", secure: true });
  await page.goto("https://adavisvg.zo.computer/", { waitUntil: "networkidle2", timeout: 60000 }).catch(() => {});
  await new Promise(r => setTimeout(r, 5000));

  const allCookies = await page.cookies();
  console.log("=== ALL COOKIES ===");
  for (const c of allCookies) {
    console.log(`${c.name} | domain=${c.domain} | value=${c.value.substring(0, 60)}${c.value.length > 60 ? "..." : ""} | len=${c.value.length}`);
  }

  // Intercept the next /ask request to see full headers
  console.log("\n=== Intercepting /ask request ===");
  page.on("request", req => {
    if (req.url().includes("/ask")) {
      console.log("URL:", req.url());
      console.log("Method:", req.method());
      console.log("Headers:");
      const headers = req.headers();
      for (const [k, v] of Object.entries(headers)) {
        if (!k.startsWith(":")) console.log(`  ${k}: ${v.substring(0, 120)}`);
      }
    }
  });

  // Type and send a message
  const inputs = await page.$$('textarea, [contenteditable="true"], [role="textbox"]');
  if (inputs.length > 0) {
    await inputs[0].click();
    await inputs[0].type("say hi", { delay: 30 });
    await page.keyboard.press("Enter");
    await new Promise(r => setTimeout(r, 10000));
  }

  await browser.close();
}

main().catch(e => { console.error("Fatal:", e); process.exit(1); });
