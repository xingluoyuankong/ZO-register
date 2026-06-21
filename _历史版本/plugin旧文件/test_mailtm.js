// 完整注册测试 - Mail.tm
const { registerOne } = require("./zo_register");

async function main() {
  const log = (msg) => {
    const ts = new Date().toLocaleTimeString('en-US', { hour12: false });
    console.log(`[${ts}] ${msg}`);
  };

  const config = {
    useTempMail: true,
    tempMailProviders: ['mailtm'],
    tempMailTimeout: 60,
    tempMailInterval: 2000,
    fetchAccessToken: true,
    tokenKeyName: 'MyApiKey',
    registeredDir: require("path").join(__dirname, "..", "registered"),
    browserType: 'edge',
  };

  const emailItem = { email: '', password: '', clientId: '', refreshToken: '' };

  try {
    const result = await registerOne(emailItem, config, log);
    console.log('\n========== RESULT ==========');
    console.log(JSON.stringify(result, null, 2));
  } catch(e) {
    console.log('\nERROR: ' + e.message);
    console.log(e.stack?.substring(0, 500));
  }
}

main().catch(e => { console.error(e); process.exit(1); });
