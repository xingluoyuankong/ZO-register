// Direct Mail.tm inbox check - no timestamps
const tempMail = require('./temp_mail');

async function main() {
  // Create email
  const r = await tempMail.createEmail({ providers: ['mailtm'] });
  require('fs').writeFileSync('test_email.json', JSON.stringify({
    email: r.email,
    provider: r.provider,
    credentials: r.credentials,
  }, null, 2));
  
  // Wait 10 seconds
  await new Promise(resolve => setTimeout(resolve, 10000));
  
  // Check inbox
  const msgs = await r.providerInstance.getMessages(r.credentials);
  require('fs').writeFileSync('test_inbox.json', JSON.stringify({
    email: r.email,
    messageCount: msgs.length,
    messages: msgs,
  }, null, 2));
  
  // Also do a raw fetch to see the actual API response
  const rawR = await fetch('https://api.mail.tm/messages', {
    headers: { 'Authorization': 'Bearer ' + r.credentials.token }
  });
  const rawText = await rawR.text();
  require('fs').writeFileSync('test_raw.json', rawText);
}

main().catch(e => {
  require('fs').writeFileSync('test_error.json', JSON.stringify({error: e.message, stack: e.stack}));
});
