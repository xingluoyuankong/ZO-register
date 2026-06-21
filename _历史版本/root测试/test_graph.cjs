const text = require('fs').readFileSync('C:\\Users\\XZXyuan\\Downloads\\批量注册邮箱\\已经使用\\rstewartrrzbwuco7lzozlp@outlook.com__sKryCK8qQm6fnnOB.txt', 'utf-8');
const parts = text.trim().split('----');
console.log('Parts:', parts.length);
console.log('Email:', parts[0]);
console.log('ClientId:', parts[2] ? parts[2].substring(0,20) : 'EMPTY');
console.log('RefreshToken length:', parts[3] ? parts[3].length : 0);

(async () => {
  const body = new URLSearchParams({
    client_id: parts[2],
    grant_type: 'refresh_token',
    refresh_token: parts[3],
    scope: 'https://graph.microsoft.com/.default offline_access',
  });
  const resp = await fetch('https://login.microsoftonline.com/consumers/oauth2/v2.0/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString(),
  });
  const data = await resp.json();
  if (data.error) { console.log('Token error:', data.error_description); return; }
  console.log('Token OK, length:', data.access_token.length);
  
  const mailResp = await fetch('https://graph.microsoft.com/v1.0/me/messages?$top=3&$select=subject,body,receivedDateTime&$orderby=receivedDateTime%20desc', {
    headers: { Authorization: 'Bearer ' + data.access_token }
  });
  const mail = await mailResp.json();
  for (const msg of (mail.value || [])) {
    console.log('---');
    console.log('Subject:', msg.subject);
    console.log('Received:', msg.receivedDateTime);
    const bodyContent = (msg.body && msg.body.content) || '';
    const preview = msg.bodyPreview || '';
    const combined = (msg.subject || '') + ' ' + preview + ' ' + bodyContent;
    
    const zoMatch = /zo\s*computer/i.test(combined);
    console.log('Has ZO match:', zoMatch);
    
    const links = combined.match(/https:\/\/www\.zo\.computer\/api\/email-login\/verify[^\s"'<>]*/gi) || [];
    console.log('Verify links found:', links.length);
    for (const link of links) {
      const clean = link.replace(/[)\]>,;!?\s]+$/, '').replace(/&amp;/g, '&');
      console.log('  Link:', clean.substring(0, 120));
    }
    
    // Also try general zo.computer links
    const allLinks = combined.match(/https?:\/\/[^\s"'<>]*zo\.computer[^\s"'<>]*/gi) || [];
    console.log('All ZO links found:', allLinks.length);
    for (const link of allLinks) {
      console.log('  Link:', link.substring(0, 120));
    }
  }
})().catch(e => console.error('Error:', e.message));
