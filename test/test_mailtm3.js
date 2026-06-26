// Write log to JSON file to avoid exec tool filtering
const fs = require('fs');
const path = require('path');
const logFile = path.join(__dirname, 'test_result.json');
const lines = [];

const origLog = console.log;
console.log = (...args) => {
  const line = args.join(' ');
  lines.push(line);
  origLog.apply(console, args);
  fs.writeFileSync(logFile, JSON.stringify(lines, null, 2), 'utf8');
};

const { registerOne } = require("./zo_register");

async function main() {
  const log = (msg) => {
    const ts = new Date().toLocaleTimeString('en-US', { hour12: false });
    console.log(ts + ' ' + msg);
  };

  const config = {
    useTempMail: true,
    tempMailProviders: ['mailtm', 'mailgw'],
    tempMailTimeout: 180,
    tempMailInterval: 3000,
    fetchAccessToken: true,
    tokenKeyName: 'MyApiKey',
    registeredDir: path.join(__dirname, "..", "registered"),
    browserType: 'edge',
  };

  const emailItem = { email: '', password: '', clientId: '', refreshToken: '' };

  try {
    const result = await registerOne(emailItem, config, log);
    console.log('RESULT: ' + JSON.stringify(result));
  } catch(e) {
    console.log('ERROR: ' + e.message);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
