const fs = require('fs');
const file = 'E:\\API获取工具\\批量注册邮箱\\已经使用\\8\\mx8b0e11426d@outlook.com.txt';
const content = fs.readFileSync(file, 'utf-8').trim();
const [email, password, clientId, refreshToken] = content.split('----').map(s => s.trim());

console.log('=== DIAG START ===');
console.log('Email:', email);
console.log('ClientId:', clientId);

(async () => {
  try {
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
    
    if (data.error) {
      console.log('TOKEN_ERR:', data.error, '-', data.error_description?.substring(0, 150));
      return;
    }
    console.log('TOKEN_OK, len:', data.access_token?.length);

    const mailResp = await fetch(
      'https://graph.microsoft.com/v1.0/me/messages?$top=5&$select=subject,body,from,receivedDateTime&$orderby=receivedDateTime%20desc',
      { headers: { Authorization: 'Bearer ' + data.access_token } }
    );
    const mail = await mailResp.json();
    
    console.log('MAILS:', mail.value?.length || 0);
    for (const msg of (mail.value || [])) {
      console.log('---');
      console.log('SUBJ:', msg.subject);
      console.log('FROM:', msg.from?.emailAddress?.address);
      console.log('DATE:', msg.receivedDateTime);
      const combined = (msg.subject || '') + ' ' + (msg.body?.content || '');
      const allLinks = combined.match(/https?:\/\/[^\s"'<>]+/gi) || [];
      const zoLinks = allLinks.filter(l => /zo\.computer/i.test(l));
      const hasZo = /zo/i.test(combined);
      console.log('HAS_ZO:', hasZo, '| ALL_LINKS:', allLinks.length, '| ZO_LINKS:', zoLinks.length);
      for (const l of zoLinks.slice(0, 3)) console.log('  ZOLINK:', l.substring(0, 150));
      if (allLinks.length > 0 && zoLinks.length === 0) {
        for (const l of allLinks.slice(0, 3)) console.log('  OTHER_LINK:', l.substring(0, 150));
      }
    }
  } catch (e) {
    console.log('EXCEPTION:', e.message);
  }
  console.log('=== DIAG END ===');
})();
