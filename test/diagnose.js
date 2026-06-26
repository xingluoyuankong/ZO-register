/**
 * Quick diagnostic: Test Graph API token + email fetching
 */
const fs = require('fs');
const path = require('path');

const EMAIL_DIR = "E:\\API获取工具\\批量注册邮箱\\已经使用\\8";
const GRAPH_TOKEN_URL = "https://login.microsoftonline.com/consumers/oauth2/v2.0/token";
const GRAPH_MAIL_URL = "https://graph.microsoft.com/v1.0/me/messages";

async function main() {
  // Pick first email file
  const files = fs.readdirSync(EMAIL_DIR).filter(f => f.endsWith('.txt'));
  if (!files.length) { console.log("No email files found!"); return; }
  
  const file = files[0];
  const content = fs.readFileSync(path.join(EMAIL_DIR, file), 'utf-8').trim();
  const [email, password, clientId, refreshToken] = content.split('----').map(s => s.trim());
  
  console.log("=== Diagnostic Test ===");
  console.log("Email:", email);
  console.log("ClientId:", clientId);
  console.log("RefreshToken:", refreshToken.substring(0, 30) + "...");
  console.log("");

  // Step 1: Get access token
  console.log("[1] Getting Graph API access token...");
  try {
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
    
    if (data.error) {
      console.log("❌ Token ERROR:", data.error);
      console.log("   Description:", data.error_description);
      return;
    }
    
    console.log("✅ Access token obtained (length:", data.access_token?.length, ")");
    console.log("   New refresh token:", data.refresh_token ? "yes" : "no");
    console.log("");
    
    // Step 2: Fetch recent emails
    console.log("[2] Fetching recent emails...");
    const mailUrl = GRAPH_MAIL_URL + "?$top=5&$select=subject,body,from,receivedDateTime&$orderby=receivedDateTime%20desc";
    const mailResp = await fetch(mailUrl, {
      headers: { Authorization: "Bearer " + data.access_token }
    });
    const mailData = await mailResp.json();
    
    if (!mailData.value || mailData.value.length === 0) {
      console.log("❌ No emails found");
      return;
    }
    
    console.log("✅ Found", mailData.value.length, "emails:");
    for (const msg of mailData.value) {
      console.log("   Subject:", msg.subject);
      console.log("   From:", msg.from?.emailAddress?.address);
      console.log("   Date:", msg.receivedDateTime);
      
      // Check for ZO links
      const bodyContent = msg.body?.content || "";
      const combined = (msg.subject || "") + " " + bodyContent;
      
      const hasZo = /zo/i.test(combined);
      console.log("   Has 'zo' reference:", hasZo);
      
      if (hasZo) {
        // Try to find links
        const hrefLinks = combined.match(/href=["']([^"']*zo\.computer[^"']*)["']/gi) || [];
        const rawLinks = combined.match(/https?:\/\/[^\s"'<>]*zo\.computer[^\s"'<>]*/gi) || [];
        const allZoLinks = [...hrefLinks, ...rawLinks];
        
        const allLinks = combined.match(/https?:\/\/[^\s"'<>]+/gi) || [];
        
        console.log("   ZO-specific links found:", allZoLinks.length);
        console.log("   All links found:", allLinks.length);
        
        if (allZoLinks.length > 0) {
          for (const link of allZoLinks.slice(0, 3)) {
            console.log("   Link:", link.substring(0, 120));
          }
        }
        if (allLinks.length > 0 && allZoLinks.length === 0) {
          console.log("   ⚠️ Has ZO reference but no zo.computer links!");
          for (const link of allLinks.slice(0, 5)) {
            console.log("   Link:", link.substring(0, 150));
          }
        }
      }
      console.log("");
    }
    
  } catch (e) {
    console.log("❌ Error:", e.message);
  }
}

main().catch(console.error);
