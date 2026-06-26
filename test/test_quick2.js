// Quick test: Catchmail.io + GPTMail (with cookies)
async function test() {
  console.log("=== Catchmail.io (api.catchmail.io) ===");
  try {
    const user = 'zotest' + Math.random().toString(36).substring(2, 10);
    const email = user + '@catchmail.io';
    console.log('Email: ' + email);
    
    const r = await fetch('https://api.catchmail.io/api/v1/mailbox?address=' + email);
    console.log('Inbox: ' + r.status + ' ' + (await r.text()).substring(0, 200));
  } catch(e) { console.log('FAIL: ' + e.message); }

  console.log("\n=== GPTMail (with homepage visit) ===");
  try {
    // Visit homepage to get cookies
    const homeR = await fetch('https://mail.chatgpt.org.uk/', { redirect: 'follow' });
    console.log('Homepage: ' + homeR.status);
    
    // Get token
    const tokenR = await fetch('https://mail.chatgpt.org.uk/api/inbox-token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Origin': 'https://mail.chatgpt.org.uk',
        'Referer': 'https://mail.chatgpt.org.uk/',
        'Accept': 'application/json',
      },
      body: '{}'
    });
    const tokenText = await tokenR.text();
    console.log('Token: ' + tokenR.status + ' ' + tokenText.substring(0, 200));
    
    const tokenData = JSON.parse(tokenText);
    const token = tokenData?.auth?.token;
    if (token) {
      const emailR = await fetch('https://mail.chatgpt.org.uk/api/generate-email', {
        headers: {
          'X-Inbox-Token': token,
          'Origin': 'https://mail.chatgpt.org.uk',
          'Referer': 'https://mail.chatgpt.org.uk/',
          'Accept': 'application/json',
        }
      });
      const emailText = await emailR.text();
      console.log('Email: ' + emailR.status + ' ' + emailText.substring(0, 200));
    }
  } catch(e) { console.log('FAIL: ' + e.message); }
}

test().catch(console.error);
