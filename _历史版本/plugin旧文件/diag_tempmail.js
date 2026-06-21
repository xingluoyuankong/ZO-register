// Diagnostic: check what happens when temp email is submitted to ZO signup
const { registerOne } = require('./zo_register');

async function main() {
  const emailItem = { email: '', password: '', clientId: '', refreshToken: '' };
  const config = {
    registeredDir: "E:\\API获取工具\\ZO注册\\registered",
    browserType: "edge",
    fetchToken: false,  // disable AT for diagnostic
    useTempMail: true,
    tempMailProviders: ['maildrop'],
    tempMailTimeout: 180,
    tempMailInterval: 3000,
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
