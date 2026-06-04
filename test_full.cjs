/**
 * Full end-to-end test: send magic link -> poll -> open -> register
 * Uses one fresh email, concurrency 1
 */
const puppeteer = require("E:\\API获取工具\\ZO注册\\node_modules\\puppeteer-core");
const fs = require("fs");
const { join } = require("path");

const CDP_PORT = 64610;
const EMAIL_DIR = "C:\\Users\\XZXyuan\\Downloads\\批量注册邮箱\\已经使用";
const SIGNUP_URL = "https://www.zo.computer/signup";
const GRAPH_TOKEN_URL = "https://login.microsoftonline.com/consumers/oauth2/v2.0/token";
const GRAPH_MAIL_URL = "https://graph.microsoft.com/v1.0/me/messages";

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function getMailToken(clientId, refreshToken) {
  const body = new URLSearchParams({
    client_id: clientId, grant_type: "refresh_token", refresh_token: refreshToken,
    scope: "https://graph.microsoft.com/.default offline_access",
  });
  const resp = await fetch(GRAPH_TOKEN_URL, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: body.toString(),
  });
  const data = await resp.json();
  if (data.error) throw new Error("Token error: " + data.error_description);
  return { accessToken: data.access_token, newRefreshToken: data.refresh_token || refreshToken };
}

async function findMagicLink(accessToken, afterTime) {
  const url = GRAPH_MAIL_URL + "?$top=5&$select=subject,body,receivedDateTime&$orderby=receivedDateTime%20desc";
  const resp = await fetch(url, { headers: { Authorization: "Bearer " + accessToken } });
  const mail = await resp.json();
  for (const msg of (mail.value || [])) {
    if (new Date(msg.receivedDateTime) < afterTime) continue;
    const combined = (msg.subject || "") + " " + ((msg.body && msg.body.content) || "");
    if (!/zo\s*computer/i.test(combined)) continue;
    const links = combined.match(/https:\/\/www\.zo\.computer\/api\/email-login\/verify[^\s"'<>]*/gi) || [];
    for (let link of links) {
      link = link.replace(/[)\]>,;!?\s]+$/, "").replace(/&amp;/g, "&");
      if (link.includes("token=")) return link;
    }
  }
  return null;
}

async function pollMagicLink(clientId, refreshToken, afterTime, log) {
  let rt = refreshToken;
  const deadline = Date.now() + 180000;
  while (Date.now() < deadline) {
    try {
      const { accessToken, newRefreshToken } = await getMailToken(clientId, rt);
      rt = newRefreshToken;
      const link = await findMagicLink(accessToken, afterTime);
      if (link) return { link, newRefreshToken: rt };
    } catch (e) { log("Poll error: " + e.message); }
    process.stdout.write(".");
    await sleep(5000);
  }
  return null;
}

async function main() {
  // Pick one unused email
  const files = fs.readdirSync(EMAIL_DIR).filter(f =>
    f.endsWith(".txt") && !f.startsWith("tokens_") && !f.startsWith("merged_") && !f.startsWith("probe") && !f.startsWith("combo")
  );
  if (files.length === 0) { console.log("No emails!"); return; }

  const content = fs.readFileSync(join(EMAIL_DIR, files[0]), "utf-8").trim();
  const [email, password, clientId, refreshToken] = content.split("----").map(s => s.trim());
  console.log("Using:", email);

  // Connect browser
  const browser = await puppeteer.connect({ browserURL: "http://localhost:" + CDP_PORT, timeout: 10000 });
  console.log("Browser connected");

  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  const log = (msg) => console.log("[" + new Date().toLocaleTimeString() + "] " + msg);

  try {
    // Step 1: Open signup
    log("Opening signup...");
    await page.goto(SIGNUP_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
    await sleep(3000);

    // Step 2: Click "Email me a sign-up link"
    log("Clicking email button...");
    const buttons = await page.$$("button");
    for (const btn of buttons) {
      const txt = await btn.evaluate(e => e.textContent);
      if (/Email me a sign-up link/i.test(txt)) {
        await btn.click();
        log("  Clicked!");
        break;
      }
    }
    await sleep(3000);

    // Step 3: Wait for email input, fill email
    log("Looking for email input...");
    let emailInput = null;
    for (let i = 0; i < 10; i++) {
      emailInput = await page.$("input[type=email], input#email, input[name=email]");
      if (!emailInput) {
        const allInputs = await page.$$("input");
        for (const inp of allInputs) {
          const ph = await inp.evaluate(e => e.placeholder || "");
          if (/email/i.test(ph)) { emailInput = inp; break; }
        }
      }
      if (emailInput) break;
      await sleep(2000);
    }
    if (!emailInput) {
      const txt = await page.evaluate(() => document.body.innerText.substring(0, 300));
      log("No input found. Page: " + txt.substring(0, 100));
      throw new Error("Email input not found");
    }

    log("Filling email...");
    await emailInput.click();
    await sleep(300);
    await emailInput.type(email, { delay: 30 });
    await sleep(1000);

    // Click Continue
    log("Clicking Continue...");
    const btns2 = await page.$$("button");
    for (const btn of btns2) {
      const txt = await btn.evaluate(e => e.textContent.trim());
      if (/^Continue$/i.test(txt)) {
        await btn.click();
        log("  Clicked Continue!");
        break;
      }
    }
    await sleep(3000);

    // Check page
    const afterText = await page.evaluate(() => document.body.innerText.substring(0, 300));
    log("After continue: " + afterText.substring(0, 80));
    if (!/check your email|login link/i.test(afterText)) {
      throw new Error("Email not sent: " + afterText.substring(0, 60));
    }

    const sendTime = new Date();
    log("Email sent! Polling inbox...");

    // Step 4: Poll for magic link
    const result = await pollMagicLink(clientId, refreshToken, sendTime, log);
    if (!result) throw new Error("No magic link in 3 min");
    console.log("\nGot link:", result.link.substring(0, 80) + "...");

    // Step 5: Open magic link in SAME page (not new context)
    log("Opening magic link in same page...");
    await page.goto(result.link, { waitUntil: "domcontentloaded", timeout: 30000 });
    await sleep(5000);

    // Wait for Turnstile
    log("Waiting for Turnstile...");
    for (let i = 0; i < 20; i++) {
      const txt = await page.evaluate(() => document.body.innerText.substring(0, 500));
      log(`  [${i * 3}s] ` + txt.substring(0, 60));
      if (/choose your handle/i.test(txt)) { log("Handle page!"); break; }
      if (/redirecting/i.test(txt)) {
        log("Redirecting... waiting more...");
        await sleep(5000);
        // Check if redirected
        const url = page.url();
        log("  URL: " + url);
        if (url.includes("you.zo") || url.includes("handle") || url.includes("signup")) {
          log("  Redirected!");
          break;
        }
      }
      if (/invalid|expired/i.test(txt) && !/redirecting/i.test(txt)) {
        throw new Error("Link expired");
      }
      // Try clicking "Continue in browser" if present
      if (i === 3 || i === 6) {
        await page.evaluate(() => {
          for (const el of document.querySelectorAll("button, a, div, span")) {
            const textNodes = Array.from(el.childNodes).filter(n => n.nodeType === 3).map(n => n.textContent.trim()).join("");
            if (/Continue in browser/i.test(textNodes)) { el.click(); return; }
          }
        });
      }
      await sleep(3000);
    }

    // Step 6: Handle page
    log("Looking for handle input...");
    let handleInput = null;
    for (let i = 0; i < 15; i++) {
      handleInput = await page.$("input[placeholder='you']");
      if (!handleInput) handleInput = await page.$("input[type=text]");
      if (handleInput) break;
      const txt = await page.evaluate(() => document.body.innerText.substring(0, 200));
      if (/choose your handle/i.test(txt)) {
        // Try harder to find input
        handleInput = await page.$("input");
        if (handleInput) break;
      }
      if (/invalid|expired/i.test(txt) && !/redirecting/i.test(txt)) throw new Error("Link expired after Turnstile");
      await sleep(2000);
    }
    if (!handleInput) throw new Error("Handle input not found");

    const handle = "user" + Math.random().toString(36).substring(2, 8);
    log("Setting handle: " + handle);
    await handleInput.click();
    await sleep(300);
    await handleInput.type(handle, { delay: 30 });
    await sleep(1000);

    // Click Continue
    const btns3 = await page.$$("button");
    for (const btn of btns3) {
      const txt = await btn.evaluate(e => e.textContent.trim());
      if (/^Continue$/i.test(txt)) { await btn.click(); break; }
    }
    await sleep(5000);
    log("Handle set! Waiting for boot...");

    // Step 7: Boot
    for (let i = 1; i <= 40; i++) {
      await sleep(5000);
      const txt = await page.evaluate(() => document.body.innerText.substring(0, 300));
      if (/go to your zo/i.test(txt)) {
        log("BOOT COMPLETE!");
        await page.evaluate(() => {
          for (const el of document.querySelectorAll("button, a")) {
            if (/go to your zo/i.test(el.textContent.trim())) { el.click(); return; }
          }
        });
        await sleep(5000);
        log("DONE! URL: " + page.url());
        log("Handle: " + handle + " | Address: " + handle + ".zo.computer");
        break;
      }
      if (/invalid|expired|something went wrong/i.test(txt) && !/booting|starting/i.test(txt)) {
        throw new Error("Boot failed");
      }
      const pct = txt.match(/(\d+\.?\d*)%/);
      if (pct && i % 3 === 0) log("Boot: " + pct[1] + "%");
    }

  } catch (e) {
    log("FAILED: " + e.message);
  } finally {
    await page.close().catch(() => {});
    await context.close().catch(() => {});
    browser.disconnect().catch(() => {});
  }
}

main().catch(e => console.error(e));
