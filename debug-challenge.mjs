/**
 * 调试脚本：查看 Cloudflare 挑战页面的 DOM 结构
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const TURNSTILE_PATCH = readFileSync(join(__dirname, "extension", "turnstile-patch", "script.js"), "utf-8");
const LOG_DIR = join(__dirname, "logs");
if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });

async function main() {
  const { chromium } = await import("playwright");
  
  console.log("[1] 启动浏览器...");
  const browser = await chromium.launch({
    headless: false,
    args: ["--disable-blink-features=AutomationControlled", "--window-size=1440,900"],
  });
  
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
    locale: "zh-CN",
  });
  
  await context.addInitScript({ content: TURNSTILE_PATCH });
  await context.addInitScript({
    content: `Object.defineProperty(navigator, 'webdriver', { get: () => undefined });`
  });
  
  const page = await context.newPage();
  
  // Step 1: 打开 ZO 首页看看有没有 Cloudflare
  console.log("[2] 打开 zo.computer...");
  await page.goto("https://www.zo.computer/signup", { waitUntil: "domcontentloaded", timeout: 30000 });
  await new Promise(r => setTimeout(r, 5000));
  
  // 获取页面信息
  const pageInfo = await page.evaluate(() => {
    const info = {
      url: location.href,
      title: document.title,
      bodyText: document.body.innerText.substring(0, 1000),
      iframes: [],
      turnstileElements: [],
      cfElements: [],
      allInputs: [],
      challengeDivs: [],
    };
    
    // 所有 iframe
    document.querySelectorAll("iframe").forEach(iframe => {
      info.iframes.push({
        src: iframe.src || "(no src)",
        name: iframe.name || "",
        id: iframe.id || "",
        width: iframe.offsetWidth,
        height: iframe.offsetHeight,
        rect: iframe.getBoundingClientRect(),
      });
    });
    
    // Turnstile 相关元素
    document.querySelectorAll(".cf-turnstile, [data-sitekey], [data-callback]").forEach(el => {
      info.turnstileElements.push({
        tag: el.tagName,
        className: el.className,
        id: el.id,
        dataset: JSON.stringify(el.dataset),
        rect: el.getBoundingClientRect(),
        innerHTML: el.innerHTML.substring(0, 300),
      });
    });
    
    // Cloudflare 相关元素
    document.querySelectorAll("[id*=cf-], [class*=cf-], [id*=cloudflare], [class*=challenge]").forEach(el => {
      info.cfElements.push({
        tag: el.tagName,
        id: el.id || "",
        className: (el.className || "").toString().substring(0, 100),
        rect: el.getBoundingClientRect(),
      });
    });
    
    // 所有 input
    document.querySelectorAll("input").forEach(inp => {
      info.allInputs.push({
        type: inp.type, name: inp.name, id: inp.id, value: inp.value.substring(0, 50),
      });
    });
    
    // 包含 challenge/verify 文本的 div
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const text = walker.currentNode.textContent.trim();
      if (text && /verify|challenge|human|captcha|checking/i.test(text) && text.length < 200) {
        info.challengeDivs.push({
          text: text.substring(0, 100),
          parentTag: walker.currentNode.parentElement?.tagName,
          parentId: walker.currentNode.parentElement?.id || "",
        });
      }
    }
    
    // 检查 window.turnstile
    info.hasTurnstile = typeof window.turnstile !== "undefined";
    info.hasTurnstileFn = typeof window.turnstileCallback === "function";
    
    // 检查所有 script src
    info.scripts = [];
    document.querySelectorAll("script[src]").forEach(s => {
      info.scripts.push(s.src);
    });
    
    return info;
  });
  
  console.log("\n=== 页面信息 ===");
  console.log("URL:", pageInfo.url);
  console.log("Title:", pageInfo.title);
  console.log("\nBody text (first 500):", pageInfo.bodyText.substring(0, 500));
  console.log("\nIframes:", JSON.stringify(pageInfo.iframes, null, 2));
  console.log("\nTurnstile elements:", JSON.stringify(pageInfo.turnstileElements, null, 2));
  console.log("\nCloudflare elements:", JSON.stringify(pageInfo.cfElements, null, 2));
  console.log("\nInputs:", JSON.stringify(pageInfo.allInputs, null, 2));
  console.log("\nChallenge divs:", JSON.stringify(pageInfo.challengeDivs, null, 2));
  console.log("\nHas window.turnstile:", pageInfo.hasTurnstile);
  console.log("Scripts:", pageInfo.scripts.join("\n  "));
  
  // 截图
  await page.screenshot({ path: join(LOG_DIR, "debug_signup.png"), fullPage: true });
  console.log("\n截图已保存: debug_signup.png");
  
  // Step 2: 发送 magic link 并打开
  console.log("\n\n[3] 发送 magic link API...");
  const email = "sanchezquinncu3w1kkhtuc74@outlook.com";
  const sendResp = await fetch("https://www.zo.computer/api/email-login/request", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, redirect: "/signup?productId=pro" }),
  });
  console.log("Send result:", sendResp.status);
  
  // 轮询 magic link
  console.log("[4] 轮询 magic link...");
  const config = JSON.parse(readFileSync(join(__dirname, "config.json"), "utf-8"));
  const emailDir = config.emailDir;
  const files = (await import("fs")).readdirSync(emailDir).filter(f => f.endsWith(".txt") && !f.startsWith("tokens_") && !f.includes("combo"));
  const content = (await import("fs")).readFileSync(join(emailDir, files[0]), "utf-8").trim();
  const parts = content.split("----").map(s => s.trim());
  const clientId = parts[2], refreshToken = parts[3];
  
  const sendTime = new Date(Date.now() - 5000);
  let magicLink = null;
  for (let i = 0; i < 30; i++) {
    try {
      const body = new URLSearchParams({
        client_id: clientId, grant_type: "refresh_token", refresh_token: refreshToken,
        scope: "offline_access https://graph.microsoft.com/Mail.Read https://graph.microsoft.com/User.Read"
      });
      const tResp = await fetch("https://login.microsoftonline.com/consumers/oauth2/v2.0/token", {
        method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: body.toString()
      });
      const tData = await tResp.json();
      if (tData.access_token) {
        const mResp = await fetch("https://graph.microsoft.com/v1.0/me/messages?$top=10&$select=subject,body,receivedDateTime&$orderby=receivedDateTime%20desc", {
          headers: { Authorization: "Bearer " + tData.access_token }
        });
        const mData = await mResp.json();
        for (const msg of (mData.value || [])) {
          if (new Date(msg.receivedDateTime) < sendTime) continue;
          const combined = (msg.subject || "") + " " + (msg.body?.content || "");
          const links = combined.match(/https?:\/\/[^\s"'<>]*zo\.computer[^\s"'<>]*/gi) || [];
          for (let link of links) {
            link = link.replace(/&amp;/g, "&").replace(/[)\]>,;]+$/, "");
            if (/\.(png|jpg|css|js)/i.test(link)) continue;
            if (/token=|verify|login/i.test(link)) { magicLink = link; break; }
          }
          if (magicLink) break;
        }
      }
    } catch (e) {}
    if (magicLink) break;
    process.stdout.write(".");
    await new Promise(r => setTimeout(r, 5000));
  }
  
  if (!magicLink) {
    console.log("\n未找到 magic link");
    await browser.close();
    return;
  }
  
  console.log("\n[5] 打开 magic link:", magicLink.substring(0, 120));
  try {
    await page.goto(magicLink, { waitUntil: "domcontentloaded", timeout: 60000 });
  } catch (e) {
    console.log("导航超时，继续...");
  }
  await new Promise(r => setTimeout(r, 8000));
  
  // 获取挑战页面信息
  const challengeInfo = await page.evaluate(() => {
    const info = {
      url: location.href,
      title: document.title,
      bodyText: document.body.innerText.substring(0, 2000),
      bodyHTML: document.body.innerHTML.substring(0, 5000),
      iframes: [],
      allButtons: [],
      turnstile: typeof window.turnstile !== "undefined",
    };
    
    document.querySelectorAll("iframe").forEach(iframe => {
      info.iframes.push({
        src: iframe.src || "(no src)",
        name: iframe.name || "",
        width: iframe.offsetWidth,
        height: iframe.offsetHeight,
        rect: iframe.getBoundingClientRect(),
      });
    });
    
    document.querySelectorAll("button, [role=button], input[type=submit]").forEach(btn => {
      info.allButtons.push({
        tag: btn.tagName,
        text: (btn.textContent || "").trim().substring(0, 100),
        type: btn.type || "",
        visible: btn.offsetParent !== null,
        rect: btn.getBoundingClientRect(),
      });
    });
    
    return info;
  });
  
  console.log("\n=== 挑战页面信息 ===");
  console.log("URL:", challengeInfo.url);
  console.log("Title:", challengeInfo.title);
  console.log("\nBody text:", challengeInfo.bodyText.substring(0, 1000));
  console.log("\nIframes:", JSON.stringify(challengeInfo.iframes, null, 2));
  console.log("\nButtons:", JSON.stringify(challengeInfo.allButtons, null, 2));
  console.log("Has turnstile:", challengeInfo.turnstile);
  console.log("\nBody HTML (first 3000):", challengeInfo.bodyHTML.substring(0, 3000));
  
  // 截图
  await page.screenshot({ path: join(LOG_DIR, "debug_challenge.png"), fullPage: true });
  console.log("\n截图已保存: debug_challenge.png");
  
  // 保存完整 HTML
  writeFileSync(join(LOG_DIR, "debug_challenge.html"), challengeInfo.bodyHTML);
  
  await browser.close();
  console.log("\n完成!");
}

main().catch(e => { console.error("Fatal:", e); process.exit(1); });
