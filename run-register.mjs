/**
 * ZO 注册主运行脚本 v6 — Edge Playwright Launch + Cloudflare Turnstile 突破
 * 
 * 方案：
 * 1. Playwright chromium.launch 启动真实 Edge 浏览器
 * 2. 最小化反检测脚本（只修复 webdriver）
 * 3. 完整注册流程：发magic link → 轮询邮箱 → 打开链接 → 突破Turnstile → 设handle
 * 4. Cloudflare 验证失败时自动刷新重试
 * 
 * 用法：
 *   node run-register.mjs                    # 注册所有待处理邮箱
 *   node run-register.mjs --count 1          # 只注册第1个
 */

import { readFileSync, readdirSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, basename } from "path";
import { fileURLToPath } from "url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

// ==================== 配置 ====================
const CONFIG_PATH = join(__dirname, "config.json");
const config = JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));

const NST_API_BASE = config.nstApiBase || "http://localhost:8848/api/v2";
const NST_API_KEY = config.nstApiKey || "";
const EMAIL_DIR = config.emailDir || "C:\\Users\\XZXyuan\\Downloads\\批量注册邮箱\\已经使用";
const LOG_DIR = join(__dirname, "logs");

const ZO_SIGNUP_URL = "https://www.zo.computer/signup";
const ZO_EMAIL_LOGIN_API = "https://www.zo.computer/api/email-login/request";
const GRAPH_TOKEN_URL = "https://login.microsoftonline.com/consumers/oauth2/v2.0/token";
const GRAPH_MAIL_URL = "https://graph.microsoft.com/v1.0/me/messages";

const args = process.argv.slice(2);
const countIdx = args.indexOf("--count");
const MAX_COUNT = countIdx >= 0 ? parseInt(args[countIdx + 1]) : Infinity;
const HEADLESS = args.includes("--headless");
const FORCE_NST = args.includes("--nstbrowser");
const emailDirArg = args.indexOf("--email-dir");
const ACTUAL_EMAIL_DIR = emailDirArg >= 0 ? args[emailDirArg + 1] : EMAIL_DIR;

// ==================== 工具 ====================
function log(msg) {
  const ts = new Date().toISOString().replace("T", " ").replace(/\.\d+Z/, "");
  console.log(`[${ts}] ${msg}`);
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function parseEmailFile(filePath) {
  const content = readFileSync(filePath, "utf-8").trim();
  const parts = content.split("----").map(s => s.trim());
  if (parts.length < 4) return null;
  return { email: parts[0], password: parts[1], clientId: parts[2], refreshToken: parts[3] };
}

function loadAccounts() {
  if (!existsSync(ACTUAL_EMAIL_DIR)) {
    log(`❌ 邮箱目录不存在: ${ACTUAL_EMAIL_DIR}`);
    return [];
  }
  const files = readdirSync(ACTUAL_EMAIL_DIR)
    .filter(f => f.endsWith(".txt"))
    .filter(f => !f.startsWith("tokens_") && !f.includes("combo") && !f.startsWith("merged_") && !f.startsWith("merge_") && !f.startsWith("probe"));
  const accounts = [];
  for (const f of files) {
    const acc = parseEmailFile(join(ACTUAL_EMAIL_DIR, f));
    if (acc && acc.email && acc.refreshToken) accounts.push({ ...acc, file: f });
  }
  return accounts;
}

function saveResult(result) {
  if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });
  const logFile = join(LOG_DIR, `results_${new Date().toISOString().slice(0, 10)}.jsonl`);
  writeFileSync(logFile, JSON.stringify({ ...result, ts: new Date().toISOString() }) + "\n", { flag: "a" });
}

function loadRegisteredEmails() {
  const registered = new Set();
  const logFile = join(LOG_DIR, `results_${new Date().toISOString().slice(0, 10)}.jsonl`);
  if (!existsSync(logFile)) return registered;
  try {
    const lines = readFileSync(logFile, "utf-8").trim().split("\n");
    for (const line of lines) {
      try {
        const r = JSON.parse(line);
        if (r.status === "success") registered.add(r.email);
      } catch (e) {}
    }
  } catch (e) {}
  return registered;
}

// ==================== Nstbrowser API ====================
async function nstIsAvailable() {
  try {
    const resp = await fetch(`${NST_API_BASE}/browser/list`, {
      headers: { "Authorization": `Bearer ${NST_API_KEY}` },
      signal: AbortSignal.timeout(3000)
    });
    return resp.ok;
  } catch { return false; }
}

// ==================== Graph API 邮件轮询 ====================
async function getMailToken(clientId, refreshToken) {
  const body = new URLSearchParams({
    client_id: clientId, grant_type: "refresh_token",
    refresh_token: refreshToken,
    scope: "offline_access https://graph.microsoft.com/Mail.Read https://graph.microsoft.com/User.Read"
  });
  const resp = await fetch(GRAPH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString()
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Token(${resp.status}): ${text.substring(0, 200)}`);
  }
  const data = await resp.json();
  if (!data.access_token) throw new Error("No access_token");
  return { accessToken: data.access_token, newRefreshToken: data.refresh_token || refreshToken };
}

async function findMagicLink(accessToken, afterTime) {
  const url = GRAPH_MAIL_URL + "?$top=15&$select=subject,body,from,receivedDateTime&$orderby=receivedDateTime%20desc";
  const resp = await fetch(url, { headers: { Authorization: "Bearer " + accessToken } });
  const mail = await resp.json();
  if (!mail.value) return null;
  
  const patterns = [
    /https?:\/\/[^\s"'<>]*zo\.computer[^\s"'<>]*/gi,
    /https?:\/\/[^\s"'<>]*cello\.so[^\s"'<>]*/gi,
  ];
  
  for (const msg of mail.value) {
    if (new Date(msg.receivedDateTime) < afterTime) continue;
    const combined = (msg.subject || "") + " " + (msg.from?.emailAddress?.address || "") + " " + (msg.body?.content || "");
    
    for (const pattern of patterns) {
      const matches = combined.match(pattern);
      if (!matches) continue;
      for (let link of matches) {
        link = link.replace(/&amp;/g, "&").replace(/[)\]>,;!?\s]+$/, "");
        // 排除静态资源
        if (/\.(png|jpg|css|js|svg|ico|woff)/i.test(link)) continue;
        if (/\/pricing|\/models|\/mission|\/blog/i.test(link)) continue;
        if (/token=|verify|login|sign|magic/i.test(link)) return link;
        // 也接受任何包含 zo.computer 的链接
        return link;
      }
    }
  }
  return null;
}

async function pollMagicLink(clientId, refreshToken, afterTime) {
  let rt = refreshToken;
  const deadline = Date.now() + 180000;
  let attempt = 0;
  while (Date.now() < deadline) {
    attempt++;
    try {
      const { accessToken, newRefreshToken } = await getMailToken(clientId, rt);
      rt = newRefreshToken;
      const link = await findMagicLink(accessToken, afterTime);
      if (link) {
        log(`  ✅ Magic link 找到! (轮询第${attempt}次)`);
        return { link, newRefreshToken: rt };
      }
    } catch (e) {
      log(`  轮询错误(#${attempt}): ${e.message}`);
    }
    process.stdout.write(".");
    await sleep(5000);
  }
  process.stdout.write("\n");
  return null;
}

// ==================== ZO API ====================
async function requestEmailLogin(email) {
  try {
    const resp = await fetch(ZO_EMAIL_LOGIN_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, redirect: "/signup?productId=pro" })
    });
    return { ok: resp.ok, status: resp.status };
  } catch (e) {
    return { ok: false, status: 0, error: e.message };
  }
}

// ==================== ★ Turnstile 核心突破 ★ ====================
async function handleTurnstile(page, magicLink) {
  log("  [Turnstile] ★ 开始处理 Cloudflare Turnstile...");
  const MAX_REFRESH = 6; // 最多刷新重试6次

  for (let refresh = 0; refresh <= MAX_REFRESH; refresh++) {
    if (refresh > 0) {
      log(`  [Turnstile] 🔄 第${refresh}次刷新页面重新来过...`);
      try {
        await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
      } catch (e) {
        // 如果 reload 失败，用 goto 重新打开 magic link
        if (magicLink) {
          try { await page.goto(magicLink, { waitUntil: "domcontentloaded", timeout: 30000 }); } catch {}
        }
      }
    }
    await sleep(3000 + Math.random() * 2000); // 等页面加载

    // ★ 等待 Cloudflare checkbox 加载完成（加载慢！需要耐心等）
    log("  [Turnstile] ⏳ 等待 Cloudflare checkbox 加载...");
    let widgetReady = false;
    for (let wait = 0; wait < 20; wait++) {
      await sleep(1500 + Math.random() * 1000);
      
      const pageResult = await page.evaluate(() => {
        const text = document.body.innerText.substring(0, 1000);
        const url = location.href;
        
        // 检查是否已跳转成功
        const hostname = (() => { try { return new URL(url).hostname; } catch { return ""; } })();
        if (hostname.endsWith(".zo.computer") && hostname !== "www.zo.computer") return { state: "navigated", text: text.substring(0, 200) };
        if (/choose your handle|set up your profile|dashboard|welcome|go to your zo/i.test(text)) return { state: "navigated", text: text.substring(0, 200) };
        
        // 检查是否报错
        if (/invalid or expired|login link/i.test(text)) return { state: "expired_error", text: text.substring(0, 200) };
        if (/redirecting/i.test(text) && /invalid|expired/i.test(text)) return { state: "expired_error", text: text.substring(0, 200) };
        
        // ★ checkbox 已加载（可点击！）
        if (/请验证您是真人|verify you are human/i.test(text)) return { state: "checkbox_ready", text: text.substring(0, 200) };
        
        // 查找 Turnstile widget iframe
        const iframes = document.querySelectorAll("iframe");
        const iframeInfo = [];
        for (const iframe of iframes) {
          const rect = iframe.getBoundingClientRect();
          iframeInfo.push({ src: (iframe.src||"").substring(0, 80), x: rect.x, y: rect.y, w: rect.width, h: rect.height });
          if (rect.width > 50 && rect.height > 20) return { state: "widget_found", text: text.substring(0, 200), iframes: iframeInfo };
        }
        
        // 查找 cf-turnstile 容器
        const cf = document.querySelector(".cf-turnstile, [data-sitekey]");
        if (cf && cf.offsetHeight > 0) return { state: "widget_found", text: text.substring(0, 200) };
        
        // Cloudflare 正在后台验证
        if (/正在验证|checking your browser|verifying your browser/i.test(text)) return { state: "verifying", text: text.substring(0, 200), iframes: iframeInfo };
        
        // Continue in browser 按钮
        if (/Continue in browser/i.test(text)) return { state: "continue_btn", text: text.substring(0, 200), iframes: iframeInfo };
        
        return { state: "unknown", text: text.substring(0, 200), iframes: iframeInfo };
      }).catch(() => ({ state: "error", text: "" }));
      
      const pageState = pageResult.state;
      
      // ★ 调试日志：显示实际页面文本
      if (wait === 0 || wait === 3 || wait === 6 || wait === 10) {
        log(`  [Turnstile] 📋 页面文本(${wait}): ${pageResult.text.replace(/\n/g, " | ").substring(0, 150)}`);
        if (pageResult.iframes) log(`  [Turnstile] 📋 iframes: ${JSON.stringify(pageResult.iframes)}`);
      }
      
      if (pageState === "navigated") {
        log("  [Turnstile] ✅ 页面已跳转，验证通过！");
        return true;
      }
      
      if (pageState === "expired_error") {
        log("  [Turnstile] ❌ 验证超时/失败！需要刷新页面重试");
        break; // 跳出等待循环，进入下一次 refresh
      }
      
      if (pageState === "checkbox_ready" || pageState === "widget_found") {
        widgetReady = true;
        log(`  [Turnstile] ✅ Widget 已加载 (${pageState})`);
        break;
      }
      
      if (pageState === "verifying") {
        if (wait % 3 === 0) log(`  [Turnstile] 正在验证中... (${wait * 2}s)`);
        continue;
      }
      
      if (pageState === "continue_btn") {
        log("  [Turnstile] 点击 Continue in browser...");
        await page.evaluate(() => {
          for (const el of document.querySelectorAll("button, a")) {
            if (/Continue in browser/i.test(el.textContent.trim())) { el.click(); return; }
          }
        }).catch(() => {});
        await sleep(3000);
        continue;
      }
      
      if (wait % 4 === 0) log(`  [Turnstile] 等待加载... (${wait * 2}s) state=${pageState}`);
    }
    
    // 如果报错就跳到下一轮 refresh
    const currentState = await page.evaluate(() => {
      const text = document.body.innerText.substring(0, 500);
      if (/invalid or expired|login link/i.test(text)) return "expired";
      return "ok";
    }).catch(() => "ok");
    
    if (currentState === "expired") {
      log("  [Turnstile] ⚠ 页面已报错，刷新...");
      continue; // 下一轮 refresh
    }

    // ★ 随机等待一段时间再点击（checkbox 加载慢！）
    const clickDelay = 2000 + Math.random() * 4000;
    log(`  [Turnstile] 随机等待 ${(clickDelay/1000).toFixed(1)}s 后点击...`);
    await sleep(clickDelay);

    // ★ 查找 widget 并点击 checkbox
    const clickResult = await findAndClickTurnstile(page);
    
    if (clickResult === "navigated") {
      log("  [Turnstile] ✅ 点击后页面已跳转，验证通过！");
      return true;
    }
    
    // ★ 点击后等待验证结果（最多30秒）
    log("  [Turnstile] 等待验证结果...");
    for (let w = 0; w < 15; w++) {
      await sleep(2000);
      const result = await page.evaluate(() => {
        const url = location.href;
        const hostname = (() => { try { return new URL(url).hostname; } catch { return ""; } })();
        const text = document.body.innerText.substring(0, 800);
        
        if (hostname.endsWith(".zo.computer") && hostname !== "www.zo.computer") return "navigated";
        if (/choose your handle|set up|dashboard|welcome|go to your zo/i.test(text)) return "navigated";
        if (/invalid or expired|login link/i.test(text)) return "expired_error";
        if (/redirecting/i.test(text)) return "redirecting";
        if (/请验证您是真人|verify you are human/i.test(text)) return "checkbox_still_visible";
        if (/Continue in browser/i.test(text) && !/请验证|verify.*human/i.test(text)) return "continue_needed";
        if (/正在验证中|checking your browser|verifying your browser/i.test(text)) return "still_verifying";
        return "pending";
      }).catch(() => "pending");
      
      if (result === "navigated") {
        log("  [Turnstile] ✅ 验证通过！页面已跳转！");
        return true;
      }
      if (result === "expired_error") {
        log("  [Turnstile] ❌ 验证失败！刷新重试...");
        break;
      }
      if (result === "redirecting") {
        log("  [Turnstile] 正在跳转中...");
        await sleep(5000);
        // 跳转后检查是否成功
        const afterRedirect = await page.evaluate(() => {
          const text = document.body.innerText.substring(0, 500);
          if (/invalid|expired/i.test(text)) return "failed";
          return "ok";
        }).catch(() => "ok");
        if (afterRedirect === "failed") {
          log("  [Turnstile] ❌ 跳转后报错，刷新重试");
          break;
        }
        log("  [Turnstile] ✅ 跳转成功！");
        return true;
      }
      if (result === "continue_needed") {
        log("  [Turnstile] 点击 Continue in browser...");
        await page.evaluate(() => {
          for (const el of document.querySelectorAll("button, a")) {
            if (/Continue in browser/i.test(el.textContent.trim())) { el.click(); return; }
          }
        }).catch(() => {});
        await sleep(3000);
      }
      if (result === "still_verifying" && w % 3 === 0) {
        log(`  [Turnstile] 仍在验证中... (${w * 2}s)`);
      }
      if (result === "checkbox_still_visible") {
        // checkbox 还在，说明上次点击没通过，再试一次
        if (w === 0 || w === 3 || w === 6) {
          log("  [Turnstile] checkbox 仍可见，重新点击...");
          await findAndClickTurnstile(page);
        }
      }
    }
    
    // 本轮结束，检查是否需要刷新
    log("  [Turnstile] 本轮未通过，准备刷新...");
  }

  log("  [Turnstile] ⚠ 达到最大重试次数");
  return false;
}

// ★ 查找并点击 Turnstile checkbox — 暴力坐标法
async function findAndClickTurnstile(page) {
  // 1. 获取浏览器尺寸和缩放比
  const browserInfo = await page.evaluate(() => {
    return {
      innerW: window.innerWidth,
      innerH: window.innerHeight,
      outerW: window.outerWidth,
      outerH: window.outerHeight,
      dpr: window.devicePixelRatio || 1,
      scrollX: window.scrollX,
      scrollY: window.scrollY,
    };
  }).catch(() => ({ innerW: 1440, innerH: 900, outerW: 1440, outerH: 900, dpr: 1, scrollX: 0, scrollY: 0 }));
  
  log(`  [Turnstile] 浏览器: ${browserInfo.innerW}x${browserInfo.innerH} DPR=${browserInfo.dpr}`);

  // 2. 用所有可能的选择器找 widget
  const widgetPos = await page.evaluate(() => {
    const results = [];
    
    // 所有 iframe
    document.querySelectorAll("iframe").forEach((iframe, idx) => {
      const rect = iframe.getBoundingClientRect();
      results.push({
        type: "iframe",
        idx,
        src: (iframe.src || "").substring(0, 120),
        name: iframe.name || "",
        id: iframe.id || "",
        x: rect.x, y: rect.y, w: rect.width, h: rect.height,
        visible: rect.width > 0 && rect.height > 0
      });
    });
    
    // cf-turnstile / data-sitekey 容器
    document.querySelectorAll(".cf-turnstile, [data-sitekey], [id*=turnstile], [class*=turnstile]").forEach((el, idx) => {
      const rect = el.getBoundingClientRect();
      results.push({
        type: "turnstile_container",
        idx,
        tag: el.tagName,
        id: el.id || "",
        className: (el.className || "").toString().substring(0, 80),
        x: rect.x, y: rect.y, w: rect.width, h: rect.height,
        visible: rect.width > 0 && rect.height > 0,
        hasShadow: !!el.shadowRoot
      });
    });
    
    // 任何包含 "请验证" 或 "verify" 文本的可见元素的父级白色容器
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const text = walker.currentNode.textContent.trim();
      if (/请验证|verify.*human|真人/i.test(text)) {
        const parent = walker.currentNode.parentElement;
        if (parent) {
          // 向上找到白色容器（通常有白色背景 + border）
          let container = parent;
          for (let i = 0; i < 5; i++) {
            if (container.parentElement && container.parentElement !== document.body) {
              container = container.parentElement;
            }
          }
          const rect = container.getBoundingClientRect();
          results.push({
            type: "verify_text_parent",
            text: text.substring(0, 60),
            parentTag: parent.tagName,
            containerTag: container.tagName,
            x: rect.x, y: rect.y, w: rect.width, h: rect.height,
            visible: rect.width > 0 && rect.height > 0
          });
        }
      }
    }
    
    return results;
  }).catch(() => []);
  
  // 打印所有找到的元素用于调试
  log(`  [Turnstile] 找到 ${widgetPos.length} 个元素:`);
  widgetPos.forEach(el => {
    log(`    ${el.type}: (${el.x?.toFixed(0)},${el.y?.toFixed(0)}) ${el.w?.toFixed(0)}x${el.h?.toFixed(0)} visible=${el.visible}${el.src ? " src=" + el.src.substring(0, 60) : ""}`);
  });

  // 3. 确定点击坐标
  let clickX, clickY;
  
  // 优先找可见的 iframe（Turnstile challenge 在 iframe 中）
  const visibleIframe = widgetPos.find(el => el.type === "iframe" && el.visible && el.w > 50 && el.h > 20);
  const turnstileContainer = widgetPos.find(el => el.type === "turnstile_container" && el.visible);
  const verifyParent = widgetPos.find(el => el.type === "verify_text_parent" && el.visible);
  
  if (visibleIframe) {
    // checkbox 在 iframe 左侧，约 x+26~34, y+h/2
    clickX = visibleIframe.x + 30 + Math.random() * 6;
    clickY = visibleIframe.y + visibleIframe.h / 2 + (Math.random() - 0.5) * 6;
    log(`  [Turnstile] ✅ 用 iframe 定位: (${visibleIframe.x.toFixed(0)},${visibleIframe.y.toFixed(0)}) ${visibleIframe.w.toFixed(0)}x${visibleIframe.h.toFixed(0)}`);
  } else if (turnstileContainer) {
    // checkbox 在容器左侧
    clickX = turnstileContainer.x + 26 + Math.random() * 8;
    clickY = turnstileContainer.y + turnstileContainer.h / 2 + (Math.random() - 0.5) * 8;
    log(`  [Turnstile] ✅ 用容器定位`);
  } else if (verifyParent) {
    // 用 "请验证" 文本的容器定位，checkbox 在容器左侧
    clickX = verifyParent.x + 30 + Math.random() * 8;
    clickY = verifyParent.y + verifyParent.h / 2 + (Math.random() - 0.5) * 8;
    log(`  [Turnstile] ✅ 用验证文本容器定位`);
  } else {
    // 暴力计算：从截图分析，checkbox 在 viewport 约 (39%, 43%) 位置
    // Cloudflare widget 通常宽~350px，居中显示，高~65px
    // checkbox 在 widget 左边缘内 ~14px，垂直居中
    const widgetW = 350;
    const widgetX = (browserInfo.innerW - widgetW) / 2;
    const widgetY = browserInfo.innerH * 0.40; // widget 约在 viewport 40% 高度
    clickX = widgetX + 28 + Math.random() * 8;
    clickY = widgetY + 32 + (Math.random() - 0.5) * 8;
    log(`  [Turnstile] ⚠ 未找到任何元素，用计算坐标: widget=(${widgetX.toFixed(0)},${widgetY.toFixed(0)})`);
  }
  
  log(`  [Turnstile] 🖱️ 最终点击: (${clickX.toFixed(1)}, ${clickY.toFixed(1)})`);
  
  // 4. 随机等待（checkbox 加载慢！）
  const preClickDelay = 1500 + Math.random() * 3000;
  log(`  [Turnstile] 等待 ${(preClickDelay/1000).toFixed(1)}s 后点击...`);
  await sleep(preClickDelay);
  
  // 5. ★ 最真实的模拟真人点击 ★
  // 真人鼠标：起点随机 → 弧线移动 → 目标附近微调 → 停顿 → 点击
  const startX = 100 + Math.random() * 300;
  const startY = 100 + Math.random() * 200;
  
  // 弧线移动：起点 → 多个中间点 → 目标
  const steps = 20 + Math.floor(Math.random() * 15);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    // 贝塞尔曲线模拟弧线
    const cx = (startX + clickX) / 2 + (Math.random() - 0.5) * 40;
    const cy = (startY + clickY) / 2 - 30 + (Math.random() - 0.5) * 20;
    const x = (1 - t) * (1 - t) * startX + 2 * (1 - t) * t * cx + t * t * clickX;
    const y = (1 - t) * (1 - t) * startY + 2 * (1 - t) * t * cy + t * t * clickY;
    await page.mouse.move(x, y);
    await sleep(8 + Math.random() * 15); // 真人每步 8-23ms
  }
  
  // 到达目标附近后微调
  await sleep(80 + Math.random() * 150);
  await page.mouse.move(clickX + (Math.random() - 0.5) * 3, clickY + (Math.random() - 0.5) * 3);
  await sleep(50 + Math.random() * 100);
  
  // 按下 → 短暂停留 → 释放（真人点击 80-200ms）
  await page.mouse.down();
  await sleep(80 + Math.random() * 120);
  await page.mouse.up();
  
  log("  [Turnstile] ✅ 点击完成");
  
  // 6. 检查是否立即跳转
  await sleep(3000);
  const quickCheck = await page.evaluate(() => {
    const url = location.href;
    const hostname = (() => { try { return new URL(url).hostname; } catch { return ""; } })();
    if (hostname.endsWith(".zo.computer") && hostname !== "www.zo.computer") return "navigated";
    const text = document.body.innerText.substring(0, 300);
    if (/choose your handle|dashboard|welcome/i.test(text)) return "navigated";
    if (/正在验证|verifying/i.test(text)) return "verifying_after_click";
    return "still_here:" + text.substring(0, 60);
  }).catch(() => "error");
  
  log(`  [Turnstile] 点击后状态: ${quickCheck}`);
  return quickCheck === "navigated" ? "navigated" : "still_here";
}

// ==================== 注册流程 ====================
async function runRegistration(context, account) {
  const { email, clientId, refreshToken } = account;
  log(`\n${"=".repeat(55)}`);
  log(`开始注册: ${email}`);
  log(`${"=".repeat(55)}`);

  const page = await context.newPage();
  await page.setViewportSize({ width: 1440, height: 900 });

  try {
    // Step 1: 打开 ZO 注册页
    log("[1/7] 打开 ZO 注册页...");
    await page.goto(ZO_SIGNUP_URL, { waitUntil: "domcontentloaded", timeout: 45000 });
    await sleep(3000);
    
    // 截图
    if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });
    await page.screenshot({ path: join(LOG_DIR, `step1_${email.split("@")[0]}.png`) }).catch(() => {});

    // Step 2: 点击 "Email me a sign-up link" 或类似按钮
    log("[2/7] 点击邮件注册按钮...");
    let clicked = false;
    for (let i = 0; i < 10; i++) {
      clicked = await page.evaluate(() => {
        for (const sel of ["button", "a", "div[role=button]"]) {
          for (const el of document.querySelectorAll(sel)) {
            const text = (el.textContent || "").trim();
            if (/email\s*(me\s*)?(a\s*)?(sign[-\s]*up|login)?\s*link|continue\s*with\s*email|use\s*email/i.test(text)) {
              if (el.offsetParent !== null) { el.click(); return text; }
            }
          }
        }
        return null;
      }).catch(() => null);
      if (clicked) break;
      await sleep(1500);
    }
    log(`  按钮: ${clicked || "未找到"}`);
    if (!clicked) log("  ⚠ 未找到邮件按钮，可能页面已变化");
    await sleep(2000);

    // Step 3: 填写邮箱并点击 Continue
    log("[3/7] 填写邮箱: " + email);
    const emailFilled = await page.evaluate((addr) => {
      const inp = document.querySelector("input[type=email]") || document.querySelector("input#email") || document.querySelector("input[name=email]");
      if (!inp) return false;
      inp.focus();
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      setter.call(inp, addr);
      inp.dispatchEvent(new Event("input", { bubbles: true }));
      inp.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    }, email).catch(() => false);

    if (!emailFilled) {
      log("  ⚠ 找不到邮箱输入框，尝试直接通过 API 发送");
    }
    await sleep(500);

    // 点击 Continue
    await page.evaluate(() => {
      for (const btn of document.querySelectorAll("button")) {
        if (/^Continue$/i.test(btn.textContent.trim())) { btn.click(); return; }
      }
    }).catch(() => {});
    await sleep(2000);
    
    await page.screenshot({ path: join(LOG_DIR, `step3_${email.split("@")[0]}.png`) }).catch(() => {});

    // Step 4: 发送 API + 轮询 magic link
    log("[4/7] 发送 magic link API + 轮询收件箱...");
    const sendTime = new Date(Date.now() - 5000);
    
    // 通过 API 发送
    const sendResult = await requestEmailLogin(email);
    log(`  API 发送: ${sendResult.ok ? "成功" : "失败(" + sendResult.status + ")"}`);

    const mailResult = await pollMagicLink(clientId, refreshToken, sendTime);
    if (!mailResult) {
      log("  ❌ 3分钟内未收到 magic link");
      await page.screenshot({ path: join(LOG_DIR, `fail_nolink_${email.split("@")[0]}.png`) }).catch(() => {});
      await page.close().catch(() => {});
      return { ok: false, error: "magic link 超时" };
    }
    log(`  ✅ Magic link: ${mailResult.link.substring(0, 100)}...`);

    // Step 5: 打开 magic link（会遇到 Turnstile）
    log("[5/7] 打开 magic link...");
    try {
      await page.goto(mailResult.link, { waitUntil: "domcontentloaded", timeout: 60000 });
    } catch (navErr) {
      if (/timeout/i.test(navErr.message)) log("  ⚠ 导航超时，继续...");
    }
    await sleep(4000);
    
    await page.screenshot({ path: join(LOG_DIR, `step5_${email.split("@")[0]}.png`) }).catch(() => {});

    // Step 5b: ★ 处理 Cloudflare Turnstile ★
    log("[5b/7] ★ Cloudflare Turnstile 人机验证...");
    const turnstileOk = await handleTurnstile(page, mailResult.link);
    
    await page.screenshot({ path: join(LOG_DIR, `step5b_${email.split("@")[0]}.png`) }).catch(() => {});

    // Step 6: 等待验证完成 + 后续步骤
    log("[6/7] 等待注册完成...");
    let success = false;
    for (let i = 0; i < 60; i++) {
      const currentUrl = page.url();
      const text = await page.evaluate(() => document.body.innerText.substring(0, 800)).catch(() => "");
      const hostname = (() => { try { return new URL(currentUrl).hostname; } catch { return ""; } })();
      const isSubdomain = hostname.endsWith(".zo.computer") && hostname !== "www.zo.computer";

      // 已到达主界面
      if (isSubdomain && /dashboard|welcome|explore|home|zo space|your conversations/i.test(text) && !/booting|starting|loading|%/i.test(text)) {
        log(`  ✅ 注册成功! URL: ${currentUrl}`);
        success = true;
        break;
      }

      // 到达 handle/profile 页面
      if (/choose your handle|set up your profile|display name/i.test(text)) {
        log("  ✅ 到达 profile 设置页面");
        const handle = email.split("@")[0].replace(/[^a-zA-Z0-9]/g, "").substring(0, 8);
        await page.evaluate((h) => {
          // 填 handle
          const inp = document.querySelector("input[placeholder='you']") || document.querySelector("input[name='handle']") || document.querySelector("input[type=text]");
          if (inp) {
            inp.focus();
            const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
            setter.call(inp, h);
            inp.dispatchEvent(new Event("input", { bubbles: true }));
            inp.dispatchEvent(new Event("change", { bubbles: true }));
          }
        }, handle).catch(() => {});
        await sleep(1000);
        // 点击 Continue
        await page.evaluate(() => {
          for (const btn of document.querySelectorAll("button")) {
            if (/^Continue$/i.test(btn.textContent.trim())) { btn.click(); return; }
          }
        }).catch(() => {});
        success = true;
        break;
      }

      // Go to your Zo
      if (/go to your zo/i.test(text)) {
        await page.evaluate(() => {
          for (const el of document.querySelectorAll("button, a, div[role=button]")) {
            if (/go to your zo/i.test(el.textContent.trim())) { el.click(); return; }
          }
        }).catch(() => {});
      }

      // 手机号跳过
      if (/verify your phone|phone number|add your phone/i.test(text)) {
        await page.evaluate(() => {
          for (const el of document.querySelectorAll("button, a, div[role=button]")) {
            if (/skip|not now/i.test(el.textContent.trim())) { el.click(); return; }
          }
        }).catch(() => {});
      }

      // Terms checkbox
      if (/terms of use|18.*years|agree/i.test(text)) {
        await page.evaluate(() => {
          for (const cb of document.querySelectorAll("input[type=checkbox]")) {
            if (!cb.checked) cb.click();
          }
        }).catch(() => {});
        await sleep(500);
        await page.evaluate(() => {
          for (const btn of document.querySelectorAll("button")) {
            if (/skip|continue/i.test(btn.textContent.trim())) { btn.click(); return; }
          }
        }).catch(() => {});
      }

      // Continue in browser
      if (/Continue in browser|Complete the browser check/i.test(text)) {
        await page.evaluate(() => {
          for (const el of document.querySelectorAll("button, a")) {
            if (/Continue in browser/i.test(el.textContent.trim())) { el.click(); return; }
          }
        }).catch(() => {});
        await sleep(2000);
        await handleTurnstile(page, mailResult.link);
      }

      // 重试 Turnstile
      if (/verify|challenge|captcha|complete the browser|verifying your browser/i.test(text)) {
        await handleTurnstile(page, mailResult.link);
      }
      
      // Invalid or expired → 刷新重试
      if (/invalid or expired|login link/i.test(text)) {
        log("  ⚠ 检测到过期/失效，刷新页面...");
        try { await page.goto(mailResult.link, { waitUntil: "domcontentloaded", timeout: 30000 }); } catch {}
        await sleep(3000);
        await handleTurnstile(page, mailResult.link);
      }

      if (i % 5 === 0) log(`  ⏳ 等待... (${i * 3}s) url=${currentUrl.substring(0, 80)}`);
      await sleep(3000);
    }

    // Step 7: 截图保存
    log("[7/7] 保存最终截图...");
    await page.screenshot({ path: join(LOG_DIR, `final_${email.split("@")[0]}_${success ? "ok" : "fail"}.png`) }).catch(() => {});

    await page.close().catch(() => {});
    return { ok: success, email, url: page.url() };

  } catch (e) {
    log(`❌ 注册异常: ${e.message}`);
    await page.screenshot({ path: join(LOG_DIR, `error_${email.split("@")[0]}.png`) }).catch(() => {});
    await page.close().catch(() => {});
    return { ok: false, email, error: e.message };
  }
}

// ==================== 主程序 ====================
async function main() {
  log("╔══════════════════════════════════════════════════════════╗");
  log("║  ZO 注册 v5 — Edge CDP + 增强 Turnstile 突破            ║");
  log("╚══════════════════════════════════════════════════════════╝");

  // 加载账号
  log(`\n📂 邮箱目录: ${ACTUAL_EMAIL_DIR}`);
  const allAccounts = loadAccounts();
  log(`✅ 加载 ${allAccounts.length} 个账号`);
  if (allAccounts.length === 0) { log("❌ 没有可用账号"); process.exit(1); }

  // 过滤已注册
  const registered = loadRegisteredEmails();
  const accounts = allAccounts.filter(a => !registered.has(a.email)).slice(0, MAX_COUNT);
  log(`📋 已注册: ${registered.size} | 待处理: ${accounts.length}`);
  if (accounts.length === 0) { log("✅ 全部已注册"); return; }

  // ==================== 启动 Edge 浏览器 (Playwright launch) ====================
  const { chromium } = await import("playwright");
  let browser;
  let context;

  // ★ 用 Playwright 原生 launch 启动真实 Edge
  // CDP 连接会留下检测痕迹，Playwright launch 更干净
  log(`\n🚀 启动 Edge 浏览器 (Playwright launch)...`);
  try {
    browser = await chromium.launch({
      channel: "msedge",
      headless: false,
      args: [
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-blink-features=AutomationControlled",
        "--window-size=1440,900",
      ],
    });
    log("✅ Edge 启动成功");
  } catch(e) {
    log(`❌ Edge 启动失败: ${e.message.substring(0, 100)}`);
    process.exit(1);
  }

  // 创建浏览器上下文
  context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: "zh-CN",
    timezoneId: "Asia/Shanghai",
  });

  // 注入最小化反检测脚本（只修复 navigator.webdriver）
  await context.addInitScript({
    content: `
      // 修复 navigator.webdriver
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      try { delete Navigator.prototype.webdriver; } catch {}
      
      // 修复 chrome.runtime（某些网站检测）
      if (!window.chrome) window.chrome = {};
      if (!window.chrome.runtime) window.chrome.runtime = {};
      
      // 修复 Permissions API
      const originalQuery = window.navigator.permissions.query;
      window.navigator.permissions.query = (parameters) => (
        parameters.name === 'notifications' ?
          Promise.resolve({ state: Notification.permission }) :
          originalQuery(parameters)
      );
      
      // 在 Cloudflare iframe 中不做任何修改
      (function() {
        try {
          var url = '';
          try { url = window.location.href; } catch(e) {}
          if (url.indexOf('challenges.cloudflare') >= 0 || url.indexOf('turnstile') >= 0) return;
          try {
            if (window.top !== window) {
              try { var t = window.top.location.href; } catch(e) { return; }
            }
          } catch(e) { return; }
        } catch(e) {}
      })();
    `
  });
  log("✅ 反检测脚本已注入");

  // 处理每个账号
  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < accounts.length; i++) {
    const account = accounts[i];
    log(`\n${"━".repeat(55)}`);
    log(`[${i + 1}/${accounts.length}] ${account.email}`);

    try {
      const result = await runRegistration(context, account);

      if (result.ok) {
        successCount++;
        saveResult({ email: account.email, status: "success", url: result.url });
        log(`✅ [${i + 1}] 注册成功: ${account.email}`);
      } else {
        failCount++;
        saveResult({ email: account.email, status: "fail", error: result.error || "unknown" });
        log(`❌ [${i + 1}] 注册失败: ${account.email} — ${result.error || "unknown"}`);
      }
    } catch (e) {
      failCount++;
      saveResult({ email: account.email, status: "error", error: e.message });
      log(`❌ [${i + 1}] 异常: ${e.message}`);
    }

    log(`\n📊 进度: ✅${successCount} ❌${failCount} 剩余${accounts.length - i - 1}`);

    if (i < accounts.length - 1) {
      const waitSec = 5 + Math.random() * 5;
      log(`⏳ 等待 ${waitSec.toFixed(1)}s...`);
      await sleep(waitSec * 1000);
    }
  }

  // 清理
  log(`\n${"═".repeat(55)}`);
  log(`🏁 全部完成! ✅成功: ${successCount} | ❌失败: ${failCount}`);
  log(`${"═".repeat(55)}`);

  // 关闭浏览器
  try { await browser.close(); } catch {}
}

main().catch(e => {
  log("致命错误: " + e.message);
  console.error(e);
  process.exit(1);
});
