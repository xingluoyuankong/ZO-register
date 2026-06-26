// Quick test: GPTMail + DuckDuckGo + Catchmail + MoeMail + others
async function test() {
  console.log("=== GPTMail (mail.chatgpt.org.uk) ===");
  try {
    // Step 1: Get guest token
    const tokenR = await fetch('https://mail.chatgpt.org.uk/api/inbox-token', {
      method: 'POST', headers: {'Content-Type': 'application/json', 'Origin': 'https://mail.chatgpt.org.uk', 'Referer': 'https://mail.chatgpt.org.uk/'},
      body: '{}'
    });
    const tokenData = await tokenR.json();
    const token = tokenData?.auth?.token;
    console.log('Token: ' + (token ? token.substring(0, 30) + '...' : 'FAIL'));
    
    if (token) {
      // Step 2: Generate email
      const emailR = await fetch('https://mail.chatgpt.org.uk/api/generate-email', {
        headers: {
          'X-Inbox-Token': token,
          'Origin': 'https://mail.chatgpt.org.uk',
          'Referer': 'https://mail.chatgpt.org.uk/',
        }
      });
      const emailData = await emailR.json();
      const email = emailData?.data?.email;
      console.log('Email: ' + email);
      
      if (email) {
        // Step 3: Check inbox
        const inboxR = await fetch('https://mail.chatgpt.org.uk/api/emails?email=' + encodeURIComponent(email), {
          headers: {'X-Inbox-Token': token, 'Origin': 'https://mail.chatgpt.org.uk'}
        });
        const inboxData = await inboxR.json();
        console.log('Inbox: ' + JSON.stringify(inboxData).substring(0, 150));
        console.log('✅ GPTMail WORKS! Domain: ' + email.split('@')[1]);
      }
    }
  } catch(e) { console.log('FAIL: ' + e.message); }

  console.log("\n=== DuckMail ===");
  try {
    const r = await fetch('https://duck.com/api/auth/create-account', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({})
    });
    console.log('Status: ' + r.status + ' ' + (await r.text()).substring(0, 200));
  } catch(e) { console.log('FAIL: ' + e.message); }

  console.log("\n=== Catchmail.io ===");
  try {
    const r = await fetch('https://catchmail.io/api/inbox', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: '{}'
    });
    console.log('Status: ' + r.status + ' ' + (await r.text()).substring(0, 200));
  } catch(e) { console.log('FAIL: ' + e.message); }

  console.log("\n=== MoeMail ===");
  try {
    const r = await fetch('https://moemail.app/api/email/new', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: '{}'
    });
    console.log('Status: ' + r.status + ' ' + (await r.text()).substring(0, 200));
  } catch(e) { console.log('FAIL: ' + e.message); }

  console.log("\n=== Freemail ===");
  try {
    const r = await fetch('https://freemail.is/api/inbox', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: '{}'
    });
    console.log('Status: ' + r.status + ' ' + (await r.text()).substring(0, 200));
  } catch(e) { console.log('FAIL: ' + e.message); }
}

test().catch(console.error);
