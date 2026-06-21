const puppeteer = require("E:\\API获取工具\\ZO注册\\node_modules\\puppeteer-core");

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const browser = await puppeteer.connect({ browserURL: "http://localhost:9222", timeout: 10000 });
  const pages = await browser.pages();
  const page = pages[0];
  await page.setViewport({ width: 1440, height: 900 });
  
  // 先导航到一个空白页
  await page.goto("about:blank", { timeout: 10000 });
  await sleep(1000);
  
  // 直接用 fetch 测试 ZO verify API
  console.log("[1] Testing ZO verify API...");
  
  // 获取 emma86296 的 token
  const CLIENT_ID = "14d82eec-204b-4c2f-b7e8-296a70dab67e";
  const REFRESH_TOKEN = "M.C533_BAY.0.U.-ClzdPcVa9tIaGSO8tnmncjALhAWvWA1YlSqRo5!o4CvUUts31g7QoO1M3WY!ElBiZ*dh6r1J1refDvN209LXHU9n4FVY1yc8Neh6xvjcViX1GiCKpBfx7V92ctaenC1pzXnrNjCb9Ye0lIDEI*Cw!2dgclUtmLNZ8HjcNiumtz1n6gp2Ed5TFCgjbah6gtTCP1OI!fQgCQMQzpvpgO8zoFF*yhumHcBAngpIlQ8GrIV4*HcnwiN*Doa4ZYLtZns5D4p364oylo3OdkrGPY9TC*NiQqSG*Kmb8YFM8KzxxS7v0bUOhsZi5zli7m4ZwJLpHXHloe*dTAjr1Wvhpy6k4TfveVz0hn9zQIow3Wu2uL1EQhebn4qr9vEwHAbelN42qukcCoPef4b8kMPOUHpyd*tyufnsIG1puK90bgD5uDRf";
  
  const body = new URLSearchParams({
    client_id: CLIENT_ID, grant_type: "refresh_token", refresh_token: REFRESH_TOKEN,
    scope: "https://graph.microsoft.com/.default offline_access",
  });
  const resp = await fetch("https://login.microsoftonline.com/consumers/oauth2/v2.0/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: body.toString(),
  });
  const data = await resp.json();
  const accessToken = data.access_token;
  
  // 获取最新邮件中的 ZO 链接
  const mailResp = await fetch(
    "https://graph.microsoft.com/v1.0/me/messages?$top=5&$select=subject,from,body,receivedDateTime&$orderby=receivedDateTime%20desc",
    { headers: { Authorization: "Bearer " + accessToken } }
  );
  const mail = await mailResp.json();
  
  let magicLink = null;
  for (const msg of (mail.value || [])) {
    const body = msg.body || {};
    const htmlBody = (body.contentType === "html" && body.content) || "";
    const textBody = (body.contentType === "text" && body.content) || "";
    const combined = (msg.subject || "") + " " + textBody + " " + htmlBody;
    
    const links = combined.match(/https?:\/\/[^\s"'<>\]]*(?:zo\.computer|zocomputer|cello\.so)[^\s"'<>\]]*/gi) || [];
    for (let link of links) {
      link = link.replace(/[)\]>,;:.!?]+$/, "").replace(/&amp;/g, "&");
      if (!link.match(/\.(png|jpg|css|js|svg|ico|woff)/i) && link.includes("/api/email-login/verify")) {
        magicLink = link;
        break;
      }
    }
    if (magicLink) break;
  }
  
  if (!magicLink) { console.log("[FAIL] No magic link found"); browser.disconnect(); return; }
  console.log("Magic link: " + magicLink.substring(0, 120));
  
  // 方法1: 直接在 about:blank 页面打开链接
  console.log("\n[2] Opening magic link via page.goto...");
  await page.goto(magicLink, { waitUntil: "domcontentloaded", timeout: 30000 });
  await sleep(2000);
  
  let url = page.url();
  console.log("URL: " + url);
  await page.screenshot({ path: "E:\\API获取工具\\ZO注册\\test_method1.png", fullPage: false });
  
  // 等待跳转
  await sleep(8000);
  url = page.url();
  console.log("URL after 8s: " + url);
  const bodyText = await page.evaluate(() => document.body?.innerText?.substring(0, 400) || "");
  console.log("Body: " + bodyText.substring(0, 200));
  await page.screenshot({ path: "E:\\API获取工具\\ZO注册\\test_method1_after.png", fullPage: false });
  
  // 检查是否成功
  if (/\/dashboard|\/account|\/home|\/welcome/i.test(url)) {
    console.log("\n[SUCCESS] Method 1 works!");
  } else if (/something went wrong|error|expired/i.test(bodyText)) {
    console.log("\n[FAIL] Something went wrong");
    
    // 方法2: 把链接中的 &amp; 替换成 &，重新试
    console.log("\n[3] Trying with decoded &...");
    const fixedLink = magicLink.replace(/&amp;/g, "&");
    await page.goto("about:blank", { timeout: 10000 });
    await sleep(1000);
    await page.goto(fixedLink, { waitUntil: "domcontentloaded", timeout: 30000 });
    await sleep(5000);
    url = page.url();
    console.log("URL: " + url);
    const bodyText2 = await page.evaluate(() => document.body?.innerText?.substring(0, 400) || "");
    console.log("Body: " + bodyText2.substring(0, 200));
    await page.screenshot({ path: "E:\\API获取工具\\ZO注册\\test_method2.png", fullPage: false });
    
    await sleep(5000);
    url = page.url();
    console.log("URL after 5s: " + url);
  }
  
  browser.disconnect();
}

main().catch(e => console.error(e));
