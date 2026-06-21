/**
 * test_workspace_chat.js — 在 ZO workspace 内尝试聊天
 */
const puppeteer = require("puppeteer-core");
const path = require("path");
const fs = require("fs");

const COOKIE_AT = "eyJhbGciOiJFUzI1NiIsImtpZCI6IjkxYmU5Yjk3LTMzM2ItNDQxMC04NmEwLTUyYTUyNzAwZDcxNSIsInR5cCI6IkpXVCJ9.eyJtb2RlIjoiYWNjZXNzIiwidHlwZSI6InVzZXIiLCJwcm9wZXJ0aWVzIjp7ImlkIjoidXNyXzFQSWh0dlZMSUZpZlRWeTciLCJmdWxsX25hbWUiOiJhZGF2aXN2Z2t4bWRwYWMxYWY5cmNuIiwiZW1haWwiOiJhZGF2aXN2Z2t4bWRwYWMxYWY5cmNuQG91dGxvb2suY29tIiwiZG9tYWlucyI6WyJhZGF2aXN2ZyJdfSwiYXVkIjoib24tc3Vic3RyYXRlIiwiaXNzIjoiaHR0cHM6Ly9hdXRoLnpvLmNvbXB1dGVyIiwic3ViIjoidXNyXzFQSWh0dlZMSUZpZlRWeTciLCJleHAiOjE3ODQ2Mzg3NjB9.MFMGYy2tLuKuwX2VRYG8uCIBgUDK3P2aIZ7H3roy-vDR4-GlxBHE198CgmmTQkxKsfJGnvEkAO75_-pvg4AcRA";
const EXT_PATH = path.join("E:\\API获取工具\\ZO注册", "turnstile-extension");

async function main() {
  const edgePath = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
  const browser = await puppeteer.launch({
    executablePath: edgePath,
    headless: false,
    args: ["--no-sandbox", `--load-extension=${EXT_PATH}`, "--disable-blink-features=AutomationControlled"],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  // Capture network requests to api.zo.computer
  page.on("request", req => {
    if (req.url().includes("api.zo.computer")) {
      const method = req.method();
      const url = req.url().replace("https://api.zo.computer", "");
      console.log(`[REQ] ${method} ${url}`);
    }
  });

  page.on("response", resp => {
    if (resp.url().includes("api.zo.computer") && resp.url().includes("ask")) {
      console.log(`[RESP] ${resp.status()} ${resp.url().replace("https://api.zo.computer", "")}`);
    }
  });

  // Set cookie
  await page.setCookie({
    name: "access_token",
    value: COOKIE_AT,
    domain: ".zo.computer",
    path: "/",
    secure: true,
  });

  console.log("[TEST] Navigating to workspace...");
  await page.goto("https://adavisvg.zo.computer/", { waitUntil: "networkidle2", timeout: 60000 }).catch(() => {});
  await new Promise(r => setTimeout(r, 5000));

  const url = page.url();
  console.log("[TEST] Current URL:", url);

  // Look for chat input
  const text = await page.evaluate(() => document.body?.innerText?.substring(0, 300) || "").catch(() => "");
  console.log("[TEST] Page text:", text.substring(0, 200).replace(/\n/g, " | "));

  // Try to find and use the chat input
  const chatInputs = await page.$$('textarea, [contenteditable="true"], input[placeholder*="message"], input[placeholder*="ask"], [role="textbox"]');
  console.log(`[TEST] Found ${chatInputs.length} chat input elements`);

  if (chatInputs.length > 0) {
    const input = chatInputs[0];
    await input.click();
    await input.type("say hello", { delay: 30 });
    await new Promise(r => setTimeout(r, 1000));

    // Find and click send button
    const sendBtns = await page.$$('button[type="submit"], button[aria-label*="send"], button[aria-label*="Send"]');
    console.log(`[TEST] Found ${sendBtns.length} send buttons`);

    if (sendBtns.length > 0) {
      console.log("[TEST] Clicking send...");
      await sendBtns[0].click();
      await new Promise(r => setTimeout(r, 10000));

      // Check response
      const afterText = await page.evaluate(() => document.body?.innerText?.substring(0, 500) || "").catch(() => "");
      console.log("[TEST] After send:", afterText.substring(0, 300).replace(/\n/g, " | "));
    } else {
      // Try pressing Enter
      console.log("[TEST] Pressing Enter to send...");
      await page.keyboard.press("Enter");
      await new Promise(r => setTimeout(r, 10000));

      const afterText = await page.evaluate(() => document.body?.innerText?.substring(0, 500) || "").catch(() => "");
      console.log("[TEST] After Enter:", afterText.substring(0, 300).replace(/\n/g, " | "));
    }
  } else {
    // Take screenshot
    await page.screenshot({ path: "C:\\Users\\XZXyuan\\.openclaw\\.openclaw\\workspace\\zo_workspace.png" });
    console.log("[TEST] Screenshot saved");

    // Try to find any interactive element
    const allInputs = await page.$$("input, textarea, [contenteditable]");
    console.log(`[TEST] Total inputs found: ${allInputs.length}`);
    for (let i = 0; i < Math.min(5, allInputs.length); i++) {
      const tag = await allInputs[i].evaluate(e => `${e.tagName}[${e.type || ''}][placeholder="${e.placeholder || ''}"]`).catch(() => "");
      console.log(`  Input ${i}: ${tag}`);
    }
  }

  await browser.close();
  console.log("[TEST] Done.");
}

main().catch(e => { console.error("Fatal:", e); process.exit(1); });
