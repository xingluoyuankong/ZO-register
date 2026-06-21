/**
 * 诊断 Graph API 和 magic link 获取问题
 * 测试账号: hanadatbqvrpoeu4gpsz@outlook.com
 */

const fs = require("fs");
const path = require("path");
const { getMailToken, findMagicLink } = require("./zo_register");

const ACCOUNT_FILE = "C:\\Users\\XZXyuan\\Downloads\\zo_all.txt";
const TEST_EMAIL = "hanadatbqvrpoeu4gpsz@outlook.com";

async function main() {
  console.log("=== Graph API & Magic Link 诊断 ===\n");
  
  // 1. 读取账号信息
  console.log("[1] 读取账号信息...");
  const lines = fs.readFileSync(ACCOUNT_FILE, "utf8").split("\n");
  let account = null;
  for (const line of lines) {
    const parts = line.split("----");
    if (parts.length >= 4 && parts[0].trim() === TEST_EMAIL) {
      account = {
        email: parts[0].trim(),
        password: parts[1].trim(),
        clientId: parts[2].trim(),
        refreshToken: parts[3].trim(),
      };
      break;
    }
  }
  
  if (!account) {
    console.error("❌ 账号未找到: " + TEST_EMAIL);
    process.exit(1);
  }
  
  console.log("✅ 账号找到:");
  console.log("   Email: " + account.email);
  console.log("   Client ID: " + account.clientId.substring(0, 20) + "...");
  console.log("   Refresh Token: " + account.refreshToken.substring(0, 20) + "...");
  
  // 2. 测试 getMailToken
  console.log("\n[2] 测试 getMailToken (获取 Graph API access token)...");
  try {
    const result = await getMailToken(account.clientId, account.refreshToken, {});
    console.log("✅ getMailToken 成功!");
    console.log("   Access Token: " + result.accessToken.substring(0, 30) + "...");
    console.log("   New Refresh Token: " + result.newRefreshToken.substring(0, 20) + "...");
    
    // 3. 测试 findMagicLink
    console.log("\n[3] 测试 findMagicLink (查找最近的 ZO 邮件)...");
    const afterTime = new Date(Date.now() - 3600000); // 过去 1 小时
    console.log("   查找 afterTime: " + afterTime.toISOString());
    
    const link = await findMagicLink(result.accessToken, afterTime, console.log, {});
    
    if (link) {
      console.log("\n✅ 找到 magic link:");
      console.log("   " + link);
    } else {
      console.log("\n⚠️ 未找到 magic link (过去 1 小时内)");
      
      // 4. 手动查看最近的邮件
      console.log("\n[4] 手动查看最近 10 封邮件...");
      const fetch = require("node-fetch");
      const url = "https://graph.microsoft.com/v1.0/me/messages"
        + "?$top=10&$select=subject,from,receivedDateTime"
        + "&$orderby=receivedDateTime%20desc";
      
      const resp = await fetch(url, {
        headers: { Authorization: "Bearer " + result.accessToken }
      });
      const mail = await resp.json();
      
      if (mail.value && mail.value.length > 0) {
        console.log("✅ 最近 " + mail.value.length + " 封邮件:");
        for (const msg of mail.value) {
          console.log("   [" + msg.receivedDateTime + "] " + msg.subject);
          console.log("     From: " + (msg.from?.emailAddress?.address || "unknown"));
        }
      } else {
        console.log("⚠️ 没有邮件或 API 返回空");
        console.log("   Response: " + JSON.stringify(mail).substring(0, 200));
      }
    }
    
  } catch (e) {
    console.error("\n❌ getMailToken 失败:");
    console.error("   " + e.message);
    console.error("\n可能原因:");
    console.error("   1. Refresh token 已失效");
    console.error("   2. Client ID 或 Secret 错误");
    console.error("   3. 微软账号被封禁 (AADSTS70000)");
    process.exit(1);
  }
  
  console.log("\n=== 诊断完成 ===");
}

main().catch(e => {
  console.error("诊断失败: " + e.message);
  process.exit(1);
});
