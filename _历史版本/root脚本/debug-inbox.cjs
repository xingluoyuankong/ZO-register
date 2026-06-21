/**
 * Debug: check inbox for magic link
 */
const { readFileSync } = require('fs');

const EMAIL_FILE = '/home/workspace/extracted_emails/amelida35vsrxp601u61w9@outlook.com.txt';
const content = readFileSync(EMAIL_FILE, 'utf-8').trim();
const [email, password, clientId, refreshToken] = content.split('----').map(s => s.trim());

console.log('Email:', email);
console.log('ClientID:', clientId?.substring(0, 20));
console.log('RefreshToken:', refreshToken?.substring(0, 30));

async function getToken() {
  const body = new URLSearchParams({
    client_id: clientId,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    scope: 'https://graph.microsoft.com/.default offline_access',
  });
  const resp = await fetch('https://login.microsoftonline.com/consumers/oauth2/v2.0/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const data = await resp.json();
  if (data.error) throw new Error('Token error: ' + JSON.stringify(data));
  return data.access_token;
}

async function main() {
  const token = await getToken();
  console.log('\nToken OK, prefix:', token.substring(0, 40));

  // Fetch last 10 messages
  const url = 'https://graph.microsoft.com/v1.0/me/messages?$top=10&$select=id,subject,from,bodyPreview,receivedDateTime&$orderby=receivedDateTime%20desc';
  const resp = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
  const data = await resp.json();

  console.log('\nRecent messages:');
  for (const msg of (data.value || [])) {
    console.log(`  [${msg.receivedDateTime}] ${msg.subject} | From: ${msg.from?.emailAddress?.name}`);
    const preview = (msg.bodyPreview || '').substring(0, 200);
    if (preview) console.log(`    Preview: ${preview}`);
    
    // Check for ZO links
    const combined = (msg.subject || '') + ' ' + (preview || '');
    const allLinks = combined.match(/https?:\/\/[^\s"'<>]+/gi) || [];
    const zoLinks = allLinks.filter(l => l.includes('zo.computer') || l.includes('zocomputer'));
    if (zoLinks.length > 0) {
      console.log(`    ZO LINKS:`, zoLinks);
    }
  }
}

main().catch(e => console.error('ERROR:', e.message));
