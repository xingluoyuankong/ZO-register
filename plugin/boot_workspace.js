/**
 * boot_workspace.js — 触发 ZO workspace boot 并等待完成
 */
const puppeteer = require("puppeteer-core");
const path = require("path");
const fs = require("fs");

const COOKIE_AT = "eyJhbGciOiJFUzI1NiIsImtpZCI6IjkxYmU5Yjk3LTMzM2ItNDQxMC04NmEwLTUyYTUyNzAwZDcxNSIsInR5cCI6IkpXVCJ9.eyJtb2RlIjoiYWNjZXNzIiwidHlwZSI6InVzZXIiLCJwcm9wZXJ0aWVzIjp7ImlkIjoidXNyXzFQSWh0dlZMSUZpZlRWeTciLCJmdWxsX25hbWUiOiJhZGF2aXN2Z2t4bWRwYWMxYWY5cmNuIiwiZW1haWwiOiJhZGF2aXN2Z2t4bWRwYWMxYWY5cmNuQG91dGxvb2suY29tIiwiZG9tYWlucyI6WyJhZGF2aXN2ZyJdfSwiYXVkIjoib24tc3Vic3RyYXRlIiwiaXNzIjoiaHR0cHM6Ly9hdXRoLnpvLmNvbXB1dGVyIiwic3ViIjoidXNyXzFQSWh0dlZMSUZpZlRWeTciLCJleHAiOjE3ODQ2Mzg3NjB9.MFMGYy2tLuKuwX2VRYG8uCIBgUDK3P2aIZ7H3roy-vDR4-GlxBHE198CgmmTQkxKsfJGnvEkAO75_-pvg4AcRA";

const HANDLE = "adavisvg";
const WORKSPACE_URL = `https://${HANDLE}.zo.computer/`;
const EXT_PATH = path.join("E:\\API获取工具\\ZO注册", "turnstile-extension");

async function main() {
  console.log("[BOOT] Starting workspace boot for", HANDLE);

  // Find Edge
  const edgePaths = [
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  ];
  const execPath = edgePaths.find(p => fs.existsSync(p));
  if (!execPath) { console.error("Edge not found!"); process.exit(1); }

  const browser = await puppeteer.launch({
    executablePath: execPath,
    headless: false,
    args: [
      "--no-sandbox",
      `--load-extension=${EXT_PATH}`,
      "--disable-blink-features=AutomationControlled",
    ],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  // Set cookie before navigating
  await page.setCookie({
    name: "access_token",
    value: COOKIE_AT,
    domain: ".zo.computer",
    path: "/",
    secure: true,
    httpOnly: false,
  });

  console.log("[BOOT] Cookie set, navigating to workspace...");
  try {
    await page.goto(WORKSPACE_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  } catch(e) {
    console.log("[BOOT] Nav timeout (may be OK):", e.message.substring(0, 50));
  }

  console.log("[BOOT] Page loaded, monitoring boot progress...");

  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 5000));
    const url = page.url();
    const text = await page.evaluate(() => document.body?.innerText?.substring(0, 300) || "").catch(() => "");
    const pctMatch = text.match(/(\d+)\s*%/);

    console.log(`[BOOT] [${i*5}s] URL: ${url.substring(0, 60)}`);
    console.log(`  Text: ${text.substring(0, 120).replace(/\n/g, " | ")}`);

    // Check if boot is done
    if (/dashboard|welcome|explore|home|zo space|files|chat|your conversations/i.test(text)
        && !/booting|starting|loading|preparing|creating|%/i.test(text)) {
      console.log("[BOOT] ✅ Workspace booted successfully!");
      break;
    }

    if (pctMatch) {
      console.log(`  Boot progress: ${pctMatch[1]}%`);
    }

    // Click any "continue" / "skip" / "next" buttons
    if (/continue|skip|next|go to your zo/i.test(text) && !/booting|starting|loading|%/i.test(text)) {
      const btns = await page.$$("button");
      for (const btn of btns) {
        const txt = await btn.evaluate(e => e.textContent.trim()).catch(() => "");
        if (/continue|skip|next|go to your zo/i.test(txt)) {
          console.log(`  Clicking: "${txt}"`);
          await btn.click().catch(() => {});
          break;
        }
      }
    }
  }

  // Check cookies after boot
  const cookies = await page.cookies();
  const atCookie = cookies.find(c => c.name === "access_token");
  console.log("\n[BOOT] Final cookies:");
  console.log(`  access_token: ${atCookie ? atCookie.value.substring(0, 50) + "..." : "NOT FOUND"}`);
  console.log(`  Final URL: ${page.url()}`);

  await browser.close();
  console.log("[BOOT] Done.");
}

main().catch(e => { console.error("Fatal:", e); process.exit(1); });
