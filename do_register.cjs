const puppeteer = require("E:\\API获取工具\\ZO注册\\node_modules\\puppeteer-core");
const { readFileSync, writeFileSync, appendFileSync } = require("fs");
async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const content = readFileSync("C:\\Users\\XZXyuan\\Downloads\\批量注册邮箱\\已经使用\\hilljulia5es7y81c6u8a@outlook.com.txt", "utf-8").trim();
  const [EMAIL, PASSWORD, CLIENT_ID, REFRESH_TOKEN] = content.split("----").map(s => s.trim());
  console.log("Email:", EMAIL);

  const browser = await puppeteer.connect({ browserURL: "http://localhost:64610", timeout: 10000 });
  const page = (await browser.pages())[0];
  await page.setViewport({ width: 1440, height: 900 });

  // 1. 直接打开注册页
  console.log("[1] Opening signup...");
  await page.goto("https://www.zo.computer/signup", { waitUntil: "networkidle2", timeout: 30000 });
  await sleep(3000);

  // 2. Email me a sign-up link → 填邮箱 → Continue
  console.log("[2] Sending magic link...");
  await page.evaluate(() => { for (const btn of document.querySelectorAll("button")) { const t = Array.from(btn.childNodes).filter(n => n.nodeType === 3).map(n => n.textContent.trim()).join(""); if (t === "Email me a sign-up link") { btn.click(); break; } } });
  await sleep(2000);
  await page.evaluate((email) => { const inp = document.getElementById("email"); const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; setter.call(inp, email); inp.dispatchEvent(new Event("input", { bubbles: true })); }, EMAIL);
  await sleep(500);
  await page.evaluate(() => { for (const btn of document.querySelectorAll("button")) if (btn.textContent.trim() === "Continue") { btn.click(); break; } });
  await sleep(3000);
  const sendTime = new Date();
  console.log("[OK] Sent at", sendTime.toISOString());

  // 3. 从收件箱提取链接
  console.log("[3] Getting link from inbox...");
  let magicLink = null;
  let rt = REFRESH_TOKEN;
  for (let i = 0; i < 36; i++) {
    const body = new URLSearchParams({ client_id: CLIENT_ID, grant_type: "refresh_token", refresh_token: rt, scope: "https://graph.microsoft.com/.default offline_access" });
    const resp = await fetch("https://login.microsoftonline.com/consumers/oauth2/v2.0/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: body.toString() });
    const data = await resp.json();
    rt = data.refresh_token || rt;
    const mail = await (await fetch("https://graph.microsoft.com/v1.0/me/messages?$top=3&$orderby=receivedDateTime%20desc&$select=subject,body,receivedDateTime", { headers: { Authorization: "Bearer " + data.access_token } })).json();
    for (const msg of (mail.value || [])) {
      if (new Date(msg.receivedDateTime) < sendTime) continue;
      const combined = (msg.subject || "") + " " + ((msg.body && msg.body.content) || "");
      if (!/zo\s*computer/i.test(combined)) continue;
      const links = combined.match(/https:\/\/www\.zo\.computer\/api\/email-login\/verify[^\s"'<>]*/gi) || [];
      if (links.length > 0) { magicLink = links[0].replace(/[)\]>,;!?\s]+$/, "").replace(/&amp;/g, "&"); break; }
    }
    if (magicLink) break;
    process.stdout.write(".");
    await sleep(5000);
  }
  if (!magicLink) { console.log("\n[FAIL] No link found"); browser.disconnect(); return; }
  console.log("\n[OK] Got link");
  if (rt !== REFRESH_TOKEN) writeFileSync("C:\\Users\\XZXyuan\\Downloads\\批量注册邮箱\\已经使用\\hilljulia5es7y81c6u8a@outlook.com.txt", [EMAIL, PASSWORD, CLIENT_ID, rt].join("----"), "utf-8");

  // 4. 打开链接，耐心等
  console.log("[4] Opening link...");
  await page.goto(magicLink, { waitUntil: "networkidle2", timeout: 30000 });
  console.log("[5] Waiting for page to settle...");
  
  for (let i = 1; i <= 30; i++) {
    await sleep(5000);
    const url = page.url();
    const bodyText = await page.evaluate(() => document.body.innerText.substring(0, 300));
    const short = bodyText.substring(0, 80).replace(/\n/g, " | ");
    console.log("  [" + i + "] " + short);

    if (/dashboard|account|home|welcome/i.test(url)) {
      console.log("\n🎉 DONE! " + EMAIL + " registered!");
      appendFileSync("E:\\API获取工具\\ZO注册\\results.jsonl", JSON.stringify({ email: EMAIL, status: "success", url, time: new Date().toISOString() }) + "\n");
      await page.screenshot({ path: "E:\\API获取工具\\ZO注册\\success.png", fullPage: false });
      browser.disconnect();
      return;
    }

    if (/invalid|expired/i.test(bodyText) && !/redirecting/i.test(bodyText)) {
      console.log("\n❌ Expired");
      browser.disconnect();
      return;
    }

    // 点 Continue in browser
    if (/continue in browser/i.test(bodyText)) {
      await page.evaluate(() => { for (const el of document.querySelectorAll("*")) if (el.textContent.trim() === "Continue in browser" && el.children.length === 0) { el.click(); break; } });
    }
  }

  console.log("\n⚠️ Timeout");
  browser.disconnect();
}

main().catch(e => console.error(e));
