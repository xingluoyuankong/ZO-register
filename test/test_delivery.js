/**
 * Test ZO email delivery across ALL temp mail providers
 * Creates email, submits to ZO, then polls for delivery
 */
const tempMail = require('./temp_mail');

async function testProvider(providerName) {
  console.log('\n========== ' + providerName.toUpperCase() + ' ==========');
  try {
    // Create email
    const result = await tempMail.createEmail({ provider: providerName, log: console.log });
    console.log('Email: ' + result.email);
    
    // Submit to ZO signup (using fetch to simulate form submission)
    console.log('Submitting to ZO signup...');
    try {
      const r = await fetch('https://www.zo.computer/api/signup', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({email: result.email})
      });
      console.log('ZO API: ' + r.status + ' ' + (await r.text()).substring(0, 100));
    } catch(e) {
      console.log('ZO API (expected): ' + e.message);
    }
    
    // Poll inbox for 60 seconds
    console.log('Polling inbox for 60s...');
    try {
      const inboxResult = await tempMail.pollInbox(result.email, result.credentials, {
        keyword: 'zo',
        provider: providerName,
        providerInstance: result.providerInstance,
        timeout: 60,
        interval: 5000,
        log: console.log,
      });
      console.log('✅ ZO EMAIL RECEIVED! Provider: ' + providerName);
      console.log('Links: ' + inboxResult.links.slice(0, 3).join('\n'));
      return { provider: providerName, success: true, email: result.email };
    } catch(e) {
      console.log('❌ No ZO email in 60s (' + providerName + ')');
      return { provider: providerName, success: false, email: result.email, error: e.message };
    }
  } catch(e) {
    console.log('❌ Provider failed: ' + e.message);
    return { provider: providerName, success: false, error: e.message };
  }
}

async function main() {
  console.log('=== ZO Email Delivery Test (ALL providers) ===');
  console.log('This tests whether each temp mail service can RECEIVE emails from zo.computer\n');
  
  // Test all providers in parallel (2 at a time to avoid rate limiting)
  const results = [];
  const batches = [];
  for (let i = 0; i < tempMail.PROVIDERS.length; i += 2) {
    batches.push(tempMail.PROVIDERS.slice(i, i + 2));
  }
  
  for (const batch of batches) {
    const promises = batch.map(p => testProvider(p));
    const batchResults = await Promise.all(promises);
    results.push(...batchResults);
  }
  
  // Summary
  console.log('\n\n========== SUMMARY ==========');
  for (const r of results) {
    const icon = r.success ? '✅' : '❌';
    console.log(icon + ' ' + r.provider.padEnd(14) + ' | ' + (r.email || 'N/A') + ' | ' + (r.error || 'OK'));
  }
  
  const working = results.filter(r => r.success);
  console.log('\n✅ Working providers for ZO: ' + working.map(r => r.provider).join(', ') || 'NONE');
}

main().catch(console.error);
