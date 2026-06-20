/**
 * Single email registration test
 */
const { registerOne } = require('./zo_register');
const fs = require('fs');
const path = require('path');

const EMAIL_DIR = "E:\\API获取工具\\批量注册邮箱\\已经使用\\8";
const REGISTERED_DIR = "E:\\API获取工具\\ZO注册\\registered";

async function main() {
  const files = fs.readdirSync(EMAIL_DIR).filter(f => f.endsWith('.txt'));
  if (!files.length) { console.log("No email files!"); return; }
  
  const file = files[10]; // Use next available file
  const content = fs.readFileSync(path.join(EMAIL_DIR, file), 'utf-8').trim();
  const [email, password, clientId, refreshToken] = content.split('----').map(s => s.trim());
  
  console.log("=== Test Registration ===");
  console.log("Email:", email);
  console.log("File:", file);
  console.log("");

  const emailItem = { email, password, clientId, refreshToken };
  const config = {
    emailDir: EMAIL_DIR,
    registeredDir: REGISTERED_DIR,
    browserType: "edge",
    fetchToken: true,
    tokenKeyName: "API Access",
  };

  const log = (msg) => {
    const ts = new Date().toLocaleTimeString();
    console.log(`[${ts}] ${msg}`);
  };

  try {
    const result = await registerOne(emailItem, config, log);
    console.log("\n=== SUCCESS ===");
    console.log(JSON.stringify(result, null, 2));
  } catch (e) {
    console.log("\n=== FAILED ===");
    console.log("Error:", e.message);
  }
}

main().catch(console.error);
