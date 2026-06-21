const { readFileSync } = require('fs');
const content = readFileSync('/home/workspace/extracted_emails/amelida35vsrxp601u61w9@outlook.com.txt', 'utf-8').trim();
const [email, , clientId, refreshToken] = content.split('----').map(s => s.trim());

async function main() {
  const tokenResp = await fetch('https://login.microsoftonline.com/consumers/oauth2/v2.0/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'client_id=' + encodeURIComponent(clientId) + '&grant_type=refresh_token&refresh_token=' + encodeURIComponent(refreshToken) + '&scope=' + encodeURIComponent('https://graph.microsoft.com/.default offline_access'),
  });
  const tokenData = await tokenResp.json();
  console.log('Token status:', tokenData.error ? 'FAIL: ' + JSON.stringify(tokenData) : 'OK');
  if (tokenData.error) return;
  const token = tokenData.access_token;

  const url = 'https://graph.microsoft.com/v1.0/me/messages?$top=5&$select=id,subject,body,receivedDateTime&$orderby=receivedDateTime%20desc';
  const resp = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
  const data = await resp.json();
  if (data.error) { console.log('Graph error:', data.error); return; }

  for (const msg of (data.value || [])) {
    const bodyContent = (msg.body?.content || '');
    console.log('\n===', msg.subject, '===', msg.receivedDateTime);
    // Extract all links from HTML
    const links = bodyContent.match(/https?:\/\/[^\s"'<>\[\]]+/gi) || [];
    for (const link of links) {
      const clean = link.replace(/[)\]>,;:.!?]+$/, '').replace(/&amp;/g, '&');
      if (clean.includes('/api/email-login/verify')) {
        console.log('MAGIC LINK:', clean);
      }
    }
    // Show first 200 chars of body for context
    const textContent = bodyContent.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').substring(0, 200);
    console.log('Body:', textContent);
  }
}
main().catch(e => console.error('FATAL:', e));
