/**
 * ZO Computer 批量注册脚本
 * ============================
 * 流程：注册页 → 发邮件 → 提取链接 → 打开 → Turnstile → Continue → handle → Go to your Zo
 *
 * 用法: node zo_batch_register.cjs [邮箱文件夹路径]
 * 邮箱格式: email----password----clientId----refreshToken (每行一个 .txt 文件)
 */

const puppeteer = require("E:\\API获取工具\\ZO注册\\node_modules\\puppeteer-core");
const { readFileSync, writeFileSync, appendFileSync, readdirSync, renameSync, mkdirSync, existsSync } = require("fs");
const { join } = require("path");

// ========== 配置 ==========
const CDP_PORT = 64610;
const EMAIL_DIR = process.argv[2] || "C:\\Users\\XZXyuan\\Downloads\\批量注册邮箱\\已经使用";
const REGISTERED_DIR = "E:\\API获取工具\\ZO注册\\registered";
const RESULTS_FILE = "E:\\API获取工具\\ZO注册\\registered\\results.jsonl";
const SIGNUP_URL = "https://www.zo.computer/signup";
const GRAPH_TOKEN_URL = "https://login.microsoftonline.com/consumers/oauth2/v2.0/token";
const GRAPH_MAIL_URL = "https://graph.microsoft.com/v1.0/me/messages";

if (!existsSync(REGISTERED_DIR)) mkdirSync(REGISTERED_DIR, { recursive: true });

// ========== 工具函数 ==========
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function log(msg) {
  const time = new Date().toISOString().substring(11, 19);
  console.log("[" + time + "] " + msg);
}

// ========== Graph API ==========
async function getMailToken(clientId, refreshToken) {
  const body = new URLSearchParams({
    client_id: clientId,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    scope: "https://graph.microsoft.com/.default offline_access",
  });
  const resp = await fetch(GRAPH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
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

async function pollMagicLink(clientId, refreshToken, afterTime, maxWaitMs = 180000) {
  let rt = refreshToken;
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    const { accessToken, newRefreshToken } = await getMailToken(clientId, rt);
    rt = newRefreshToken;
    const link = await findMagicLink(accessToken, afterTime);
    if (link) return { link, newRefreshToken: rt };
    process.stdout.write(".");
    await sleep(5000);
  }
  return null;
}

// ========== 浏览器操作 ==========
async function waitForTurnstile(page, maxWait = 60000) {
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    const bodyText = await page.evaluate(() => document.body.innerText.substring(0, 300));
    // Turnstile 完成后页面会变成 "Choose your handle" 或其他状态
    if (!/verifying your browser|complete the browser check/i.test(bodyText)) {
      return true;
    }
    await sleep(3000);
  }
  return false;
}

async function clickElement(page, pattern) {
  return page.evaluate((p) => {
    for (const el of document.querySelectorAll("button, a, div[role=button], span")) {
      if (new RegExp(p, "i").test(el.textContent.trim()) && el.offsetParent !== null) {
        el.click();
        return true;
      }
    }
    return false;
  }, pattern);
}

async function fillInput(page, selector, value) {
  await page.evaluate((sel, val) => {
    const inp = typeof sel === "string" ? document.querySelector(sel) : document.getElementById(sel);
    if (!inp) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    setter.call(inp, val);
    inp.dispatchEvent(new Event("input", { bubbles: true }));
    inp.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }, selector, value);
}

// ========== 单个邮箱注册流程 ==========
async function registerOne(browser, email, password, clientId, refreshToken) {
  const page = (await browser.pages())[0];
  page.setDefaultTimeout(60000);
  await page.setViewport({ width: 1440, height: 900 });

  function getBodyText(len) {
    return page.evaluate((l) => document.body.innerText.substring(0, l), len || 500).catch(() => "");
  }

  // Step 1: 打开注册页
  log("[1/7] Opening signup page...");
  await page.goto(SIGNUP_URL, { waitUntil: "domcontentloaded", timeout: 45000 });
  await sleep(2000);

  // Step 2: 点击 "Email me a sign-up link"
  log("[2/7] Clicking 'Email me a sign-up link'...");
  let emailBtnClicked = false;
  for (let attempt = 0; attempt < 3 && !emailBtnClicked; attempt++) {
    emailBtnClicked = await page.evaluate(() => {
      for (const btn of document.querySelectorAll("button")) {
        if (/Email me a sign-up link/i.test(btn.textContent)) { btn.click(); return true; }
      }
      return false;
    });
    if (!emailBtnClicked) await sleep(2000);
  }
  if (!emailBtnClicked) throw new Error("找不到 'Email me a sign-up link' 按钮");
  await sleep(2000);

  // Step 3: 填邮箱 → Continue
  log("[3/7] Filling email: " + email);
  let emailInput = null;
  for (let i = 0; i < 15; i++) {
    emailInput = await page.$("input[type=email], input#email, input[name=email]");
    if (emailInput) break;
    await sleep(2000);
  }
  if (!emailInput) throw new Error("Email input not found");

  await emailInput.click({ clickCount: 3 }); await sleep(200);
  await emailInput.type(email, { delay: 30 }); await sleep(500);

  const typedValue = await emailInput.evaluate(e => e.value).catch(() => "");
  if (typedValue !== email) {
    await fillInput(page, "email", email);
    await sleep(500);
  }

  await clickElement(page, "^Continue$");
  await sleep(4000);

  // 确认邮件已发送
  let pageText = await getBodyText(400);
  if (!/check your email|login link|we sent/i.test(pageText)) {
    if (/continue|back/i.test(pageText)) {
      log("  重试 Continue...");
      await clickElement(page, "^Continue$");
      await sleep(4000);
      pageText = await getBodyText(300);
      if (!/check your email|login link|we sent/i.test(pageText)) {
        throw new Error("邮件发送失败: " + pageText.substring(0, 80));
      }
    } else {
      throw new Error("邮件发送失败: " + pageText.substring(0, 80));
    }
  }
  const sendTime = new Date();
  log("[OK] Email sent at " + sendTime.toISOString());

  // Step 4: 从收件箱提取魔法链接
  log("[4/7] Polling inbox for magic link...");
  const result = await pollMagicLink(clientId, refreshToken, sendTime);
  if (!result) throw new Error("3分钟内未收到魔法链接");
  const { link, newRefreshToken } = result;
  log("[OK] Got magic link");

  if (newRefreshToken !== refreshToken) {
    const content = [email, password, clientId, newRefreshToken].join("----");
    writeFileSync(join(EMAIL_DIR, email + ".txt"), content, "utf-8");
  }

  // Step 5: 打开魔法链接 - 增加超时，容忍导航超时
  log("[5/7] Opening magic link...");
  try {
    await page.goto(link, { waitUntil: "domcontentloaded", timeout: 60000 });
  } catch (navErr) {
    if (/timeout/i.test(navErr.message)) {
      log("  导航超时(Turnstile预期行为)，继续...");
    } else if (/net::ERR_/i.test(navErr.message)) {
      throw new Error("网络错误: " + navErr.message);
    } else {
      log("  导航异常: " + navErr.message + "，继续...");
    }
  }
  await sleep(3000);

  // Step 5b: 等待 Turnstile → "Continue in browser" → handle 页面
  log("  等待 Turnstile/重定向...");
  let reachedHandlePage = false;
  for (let i = 0; i < 30; i++) {
    let bodyText = await getBodyText(600);

    if (/choose your handle/i.test(bodyText)) {
      log("  到达 handle 页面!");
      reachedHandlePage = true;
      break;
    }

    if (/invalid|expired/i.test(bodyText) && !/redirecting|verif/i.test(bodyText)) {
      throw new Error("魔法链接已过期");
    }

    // 每次迭代都尝试点击 "Continue in browser"
    const clickedContinue = await page.evaluate(() => {
      for (const el of document.querySelectorAll("button, a, div[role=button], span")) {
        if (/Continue in browser/i.test(el.textContent.trim()) && el.offsetParent !== null) {
          el.click(); return true;
        }
      }
      return false;
    }).catch(() => false);

    if (clickedContinue) {
      log("  点击了 'Continue in browser'，等待导航...");
      await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => {});
      await sleep(3000);
      bodyText = await getBodyText(300);
      if (/choose your handle/i.test(bodyText)) { reachedHandlePage = true; break; }
      continue;
    }

    if (/redirecting/i.test(bodyText)) { await sleep(5000); continue; }
    if (i > 0 && i % 5 === 0) log("  仍在等待... [" + i * 3 + "s]");
    await sleep(3000);
  }

  if (!reachedHandlePage) {
    const finalTxt = await getBodyText(300);
    if (/choose your handle/i.test(finalTxt)) {
      reachedHandlePage = true;
    } else {
      throw new Error("未能到达 handle 页面: " + finalTxt.substring(0, 80));
    }
  }

  // Step 6: 选择 handle → Continue
  log("[6/7] Setting handle...");
  let handleInput = null;
  for (let i = 0; i < 20; i++) {
    handleInput = await page.$("input[placeholder='you']");
    if (!handleInput) handleInput = await page.$("input[type=text]");
    if (!handleInput) handleInput = await page.$("input:not([type=hidden]):not([type=submit])");
    if (handleInput) break;
    await sleep(2000);
  }
  if (!handleInput) throw new Error("Handle input not found");

  const handle = "user" + Math.random().toString(36).substring(2, 8);
  log("  Handle: " + handle);
  await handleInput.click({ clickCount: 3 }); await sleep(200);
  await handleInput.type(handle, { delay: 30 }); await sleep(1000);

  await clickElement(page, "^Continue$");
  await sleep(5000);

  // Step 7: 等待 boot 完成 → Go to your Zo
  log("[7/7] Waiting for computer to boot...");
  for (let i = 1; i <= 50; i++) {
    await sleep(5000);
    const bodyText = await getBodyText(400);

    if (/go to your zo/i.test(bodyText)) {
      log("  Boot complete! Clicking 'Go to your Zo'...");
      await clickElement(page, "go to your zo");
      await sleep(8000);
      const finalUrl = page.url();
      log("[OK] Final URL: " + finalUrl);

      const regResult = {
        email, handle, url: finalUrl,
        zoAddress: handle + ".zo.computer",
        time: new Date().toISOString(), status: "success"
      };
      appendFileSync(RESULTS_FILE, JSON.stringify(regResult) + "\n");

      try {
        renameSync(join(EMAIL_DIR, email + ".txt"), join(REGISTERED_DIR, email + ".txt"));
      } catch (e) {}

      return regResult;
    }

    if (/invalid|expired|something went wrong/i.test(bodyText) && !/booting|starting|%/i.test(bodyText)) {
      throw new Error("Boot 失败: " + bodyText.substring(0, 100));
    }

    const pct = bodyText.match(/(\d+\.?\d*)%/);
    if (pct && i % 3 === 0) log("  Boot: " + pct[1] + "%");
  }

  throw new Error("Boot 超时（250秒）");
}

// ========== 主流程：批量注册 ==========
async function main() {
  log("=== ZO Computer 批量注册 ===");
  log("邮箱目录: " + EMAIL_DIR);
  log("已注册目录: " + REGISTERED_DIR);

  // 连接浏览器
  let browser;
  try {
    browser = await puppeteer.connect({ browserURL: "http://localhost:" + CDP_PORT, timeout: 10000 });
    log("已连接浏览器 (CDP port " + CDP_PORT + ")");
  } catch (e) {
    log("[ERROR] 无法连接浏览器，请确保 Chrome 已启动并开启 CDP 端口 " + CDP_PORT);
    log("  启动命令: chrome.exe --remote-debugging-port=" + CDP_PORT);
    process.exit(1);
  }

  // 扫描邮箱文件
  const files = readdirSync(EMAIL_DIR).filter(f =>
    f.endsWith(".txt") &&
    !f.startsWith("tokens_") &&
    !f.startsWith("merged_") &&
    !f.startsWith("probe") &&
    !f.startsWith("combo")
  );

  if (files.length === 0) {
    log("没有找到邮箱文件");
    browser.disconnect();
    return;
  }

  log("找到 " + files.length + " 个邮箱文件\n");

  let success = 0, fail = 0;

  for (const file of files) {
    const filePath = join(EMAIL_DIR, file);
    let content;
    try {
      content = readFileSync(filePath, "utf-8").trim();
    } catch (e) {
      log("[SKIP] 无法读取: " + file);
      continue;
    }

    const parts = content.split("----").map(s => s.trim());
    if (parts.length < 4) {
      log("[SKIP] 格式错误 (需要4段): " + file);
      continue;
    }

    const [email, password, clientId, refreshToken] = parts;
    log("────────────────────────────────");
    log("注册: " + email);

    try {
      const result = await registerOne(browser, email, password, clientId, refreshToken);
      log("🎉 成功! Handle: " + result.handle + " | " + result.zoAddress);
      success++;
    } catch (e) {
      log("❌ 失败: " + e.message);
      appendFileSync(RESULTS_FILE, JSON.stringify({
        email, status: "fail", error: e.message, time: new Date().toISOString()
      }) + "\n");
      fail++;
    }

    // 每个邮箱之间等 5 秒
    if (files.indexOf(file) < files.length - 1) {
      log("等待 5 秒...");
      await sleep(5000);
    }
  }

  log("\n============================");
  log("完成! 成功: " + success + " | 失败: " + fail + " | 总计: " + files.length);
  log("结果: " + RESULTS_FILE);
  log("已注册邮箱: " + REGISTERED_DIR);

  browser.disconnect();
}

main().catch(e => {
  log("[FATAL] " + e.message);
  process.exit(1);
});
