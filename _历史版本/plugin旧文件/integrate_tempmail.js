const fs = require('fs');
const p = 'E:/API获取工具/ZO注册/plugin/zo_register.js';
let c = fs.readFileSync(p, 'utf-8');

// 1. Add temp_mail require at the top
if (!c.includes("require('./temp_mail')") && !c.includes('require("./temp_mail")')) {
  c = c.replace(
    'const os = require("os");',
    'const os = require("os");\nconst tempMail = require("./temp_mail");'
  );
  console.log('✅ Added temp_mail require');
} else {
  console.log('⏭️ temp_mail require already exists');
}

// 2. Modify registerOne function signature and add temp email support
// Find the registerOne function start
const regOneMatch = 'async function registerOne(emailItem, config, log) {';
const regOneIdx = c.indexOf(regOneMatch);
if (regOneIdx < 0) { console.log('❌ registerOne not found'); process.exit(1); }

// Find the email destructuring line
const destructureMatch = 'const { email, password, clientId, refreshToken } = emailItem;';
const destructureIdx = c.indexOf(destructureMatch, regOneIdx);
if (destructureIdx < 0) { console.log('❌ email destructuring not found'); process.exit(1); }

// Replace the destructuring with temp mail support
const newDestructure = `const { email: origEmail, password, clientId, refreshToken } = emailItem;
  
  // ★ Temp email mode: generate on-the-fly instead of using pre-registered Outlook accounts
  let email = origEmail;
  let tempMailResult = null;
  if (config.useTempMail) {
    log("[TEMP-MAIL] Creating temp email...");
    tempMailResult = await tempMail.createEmail({
      providers: config.tempMailProviders || tempMail.PROVIDERS,
      log
    });
    email = tempMailResult.email;
    log("[TEMP-MAIL] Using: " + email + " (provider: " + tempMailResult.provider + ")");
  }`;

c = c.replace(destructureMatch, newDestructure);
console.log('✅ Modified email destructuring for temp mail support');

// 3. Replace the Step 4 polling section to support both modes
// Find the polling section
const pollSection = '    const sendTime = new Date(Date.now() - 3000);\n    log("[4/7] Email sent! Polling inbox...");\n\n    // Step 4: Poll for magic link\n    const result = await pollMagicLink(email, clientId, refreshToken, sendTime, log, config);';
const pollIdx = c.indexOf(pollSection);
if (pollIdx < 0) { console.log('❌ poll section not found'); process.exit(1); }

const newPollSection = `    const sendTime = new Date(Date.now() - 3000);
    log("[4/7] Email sent! Polling inbox...");

    // Step 4: Poll for magic link
    let result;
    if (config.useTempMail && tempMailResult) {
      // ★ Temp mail mode: poll via provider API
      log("[4/7] Polling temp mail inbox (" + tempMailResult.provider + ")...");
      try {
        const inboxResult = await tempMail.pollInbox(email, tempMailResult.credentials, {
          keyword: "zo.computer",
          provider: tempMailResult.provider,
          providerInstance: tempMailResult.providerInstance,
          timeout: config.tempMailTimeout || 180,
          interval: config.tempMailInterval || 3000,
          log,
          linkFilter: (url) => /zo\\.computer/i.test(url) && /token=|verify|login|sign|email-login/i.test(url)
        });
        
        // Extract the best magic link
        const zoLinks = inboxResult.links.filter(l => /token=|verify|login|sign|email-login/i.test(l));
        if (zoLinks.length > 0) {
          result = { link: zoLinks[0], newRefreshToken: refreshToken };
          log("[4/7] ✅ Magic link found via " + tempMailResult.provider + "!");
        } else if (inboxResult.links.length > 0) {
          result = { link: inboxResult.links[0], newRefreshToken: refreshToken };
          log("[4/7] ✅ Link found via " + tempMailResult.provider + "!");
        } else {
          result = null;
        }
      } catch (e) {
        log("[4/7] Temp mail poll error: " + e.message);
        result = null;
      }
    } else {
      // ★ Graph API mode (original)
      result = await pollMagicLink(email, clientId, refreshToken, sendTime, log, config);
    }`;

c = c.replace(pollSection, newPollSection);
console.log('✅ Modified Step 4 polling for dual mode');

// 4. Modify handle generation for temp emails (use first 8 chars of local part)
const handleMatch = `const handle = email.split("@")[0].substring(0, 8).toLowerCase().replace(/[^a-z0-9]/g, "");`;
if (c.includes(handleMatch)) {
  // Handle is already fine - it uses email.split("@")[0].substring(0,8)
  // For temp emails like "zoyw10afux8e@maildrop.cc" → handle = "zoyw10af" (8 chars)
  console.log('✅ Handle generation already works with temp emails');
} else {
  console.log('⚠️ Handle generation pattern not found exactly');
}

// 5. Skip the refresh token update for temp mail mode (no Outlook token file)
const tokenUpdateMatch = `    // Update refresh token if changed
    if (newRefreshToken !== refreshToken && config.emailDir) {
      const tokenFile = join(config.emailDir, email + ".txt");
      if (existsSync(tokenFile)) {
        writeFileSync(tokenFile, [email, password, clientId, newRefreshToken].join("----"), "utf-8");
      }
    }`;
if (c.includes(tokenUpdateMatch)) {
  const newTokenUpdate = `    // Update refresh token if changed (Graph API mode only)
    if (!config.useTempMail && newRefreshToken !== refreshToken && config.emailDir) {
      const tokenFile = join(config.emailDir, email + ".txt");
      if (existsSync(tokenFile)) {
        writeFileSync(tokenFile, [email, password, clientId, newRefreshToken].join("----"), "utf-8");
      }
    }`;
  c = c.replace(tokenUpdateMatch, newTokenUpdate);
  console.log('✅ Skip token file update for temp mail mode');
}

// 6. Add config defaults for temp mail
const configMatch = '  registeredDir: null, // set by caller';
if (c.includes(configMatch)) {
  const newConfig = `  registeredDir: null, // set by caller
  useTempMail: false, // true = use temp email services instead of Outlook
  tempMailProviders: null, // null = use all providers, or specify array like ['maildrop','mailtm']
  tempMailTimeout: 180, // seconds to wait for magic link
  tempMailInterval: 3000, // ms between inbox polls
  concurrency: 1, // number of parallel registrations`;
  c = c.replace(configMatch, newConfig);
  console.log('✅ Added temp mail config defaults');
}

fs.writeFileSync(p, c, 'utf-8');
console.log('\n📄 File written. Checking syntax...');
try {
  new Function(fs.readFileSync(p, 'utf-8'));
  console.log('✅ Syntax OK');
} catch(e) {
  console.log('❌ Syntax error: ' + e.message);
}
