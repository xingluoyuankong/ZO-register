/**
 * 测试：等待 ZO 邮件到达并提取魔法链接
 */
const puppeteer = require("E:\\API获取工具\\ZO注册\\node_modules\\puppeteer-core");

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const CLIENT_ID = "14d82eec-204b-4c2f-b7e8-296a70dab67e";
  const REFRESH_TOKEN = "M.C544_BAY.0.U.-CsNjYag3ONx7p!GpyTPGLsxP0IeGAdCjSlmBsv62beEi1WzodfaT5*Qj8smcP9OHw*4VIag9szYj*xmc63c**X718erD3MmKg6qh!*9dcG5IFJtWqtMXbxR95V2I*M1fAeZ0j08VJQiqpuef7a4PX*Pmfl3B74GSFo*s!35zdyGj3ik8WSh0nBMJg5UPRl*oxe5ddFUujnOGvAA*uwrZ8oE9Q5laIqDFDsZyFry*IU4rBrwmcH90H2Z2SYK8rGcHMzPQXtx9eWYosrTN4aEUWCqZSiZjd8zdNH0kYk9PkUpXSR5BjsPB08hIefOOsY8Ux9Y6p6sf7iI5eywdjpRHcTADgHd4eScl*yw5DI8UPgFwftuRFRtqQ!mZaTvJl3ejWv*VNIWXm*nrgFvP7N*wmMEjcush0k6xCFYXz6tczWql";
  
  // Refresh token
  const body = new URLSearchParams({
    client_id: CLIENT_ID, grant_type: "refresh_token", refresh_token: REFRESH_TOKEN,
    scope: "https://graph.microsoft.com/.default offline_access",
  });
  const resp = await fetch("https://login.microsoftonline.com/consumers/oauth2/v2.0/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: body.toString(),
  });
  const data = await resp.json();
  const accessToken = data.access_token;
  console.log("Token OK, scope:", data.scope);
  
  // Poll for magic link
  for (let attempt = 1; attempt <= 30; attempt++) {
    const mailResp = await fetch(
      "https://graph.microsoft.com/v1.0/me/messages?$top=15&$select=id,subject,from,body,bodyPreview,receivedDateTime&$orderby=receivedDateTime%20desc",
      { headers: { Authorization: "Bearer " + accessToken } }
    );
    const mail = await mailResp.json();
    const messages = mail.value || [];
    
    for (const msg of messages) {
      const body = msg.body || {};
      const htmlBody = (body.contentType === "html" && body.content) || "";
      const textBody = (body.contentType === "text" && body.content) || "";
      const combined = (msg.subject || "") + " " + (msg.bodyPreview || "") + " " + textBody + " " + htmlBody;
      
      if (/zo\.computer|zocomputer|cello\.so/i.test(combined)) {
        const links = combined.match(/https?:\/\/[^\s"'<>\]]*(?:zo\.computer|zocomputer|cello\.so)[^\s"'<>\]]*/gi) || [];
        if (links.length > 0) {
          const link = links[0].replace(/[)\]>,;:.!?]+$/, "");
          console.log("\n[FOUND] Attempt " + attempt);
          console.log("Subject:", msg.subject);
          console.log("From:", msg.from?.emailAddress?.name || "?");
          console.log("Link:", link);
          
          // 打开链接
          const browser = await puppeteer.connect({ browserURL: "http://localhost:9222", timeout: 10000 });
          const pages = await browser.pages();
          const page = pages[0];
          await page.setViewport({ width: 1440, height: 900 });
          
          console.log("\nOpening magic link in browser...");
          await page.goto(link, { waitUntil: "domcontentloaded", timeout: 30000 });
          await sleep(3000);
          
          const url = page.url();
          console.log("URL after magic link:", url);
          await page.screenshot({ path: "E:\\API获取工具\\ZO注册\\test_magic_link.png", fullPage: false });
          
          await sleep(5000);
          const laterUrl = page.url();
          console.log("URL after 5s:", laterUrl);
          await page.screenshot({ path: "E:\\API获取工具\\ZO注册\\test_after_5s.png", fullPage: false });
          
          if (/\/dashboard|\/account|\/home|\/welcome/i.test(laterUrl)) {
            console.log("\n[SUCCESS] Registration complete!");
          } else {
            console.log("\n[DONE] Check screenshots");
          }
          
          browser.disconnect();
          return;
        }
      }
    }
    
    console.log("Attempt " + attempt + ": no ZO email yet...");
    await sleep(5000);
  }
  
  console.log("[FAIL] Magic link not found after 30 attempts");
}

main().catch(e => console.error(e));
