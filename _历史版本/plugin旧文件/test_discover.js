// Test new discoveries: DropMail.me, Aitre, and check for more
async function test() {
  console.log("=== DropMail.me (GraphQL) ===");
  try {
    // Generate token
    const tokenR = await fetch('https://dropmail.me/api/token/generate', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({type: 'af', lifetime: '1h'})
    });
    console.log('Token: ' + tokenR.status + ' ' + (await tokenR.text()).substring(0, 200));
    
    if (tokenR.status === 200) {
      const tokenData = await tokenR.clone().json().catch(() => ({}));
      const token = tokenData.token;
      if (token) {
        // Create session
        const sessR = await fetch('https://dropmail.me/api/graphql/' + token, {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({query: 'mutation { introduceSession(input: {withAddress: true}) { id expiresAt addresses { address restoreKey } } }'})
        });
        const sessData = await sessR.json();
        console.log('Session: ' + JSON.stringify(sessData).substring(0, 300));
        
        if (sessData.data?.introduceSession) {
          const addrs = sessData.data.introduceSession.addresses;
          console.log('Emails: ' + addrs.map(a => a.address).join(', '));
          const sessId = sessData.data.introduceSession.id;
          
          // Check inbox
          const inboxR = await fetch('https://dropmail.me/api/graphql/' + token, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({query: '{ session(id: "' + sessId + '") { mails { rawSize fromAddr subject downloadUrl headerSubject text html } } }'})
          });
          console.log('Inbox: ' + (await inboxR.text()).substring(0, 200));
        }
      }
    }
  } catch(e) { console.log('FAIL: ' + e.message); }

  console.log("\n=== Aitre (mail.aitre.cc) ===");
  try {
    // Try the API
    const testEmail = 'zotest99@aitre.cc';
    const r = await fetch('https://mail.aitre.cc/api/emails?email=' + testEmail);
    console.log('Emails: ' + r.status + ' ' + (await r.text()).substring(0, 200));
    
    // Also try with a different domain
    const testEmail2 = 'zotest99@mail.aitre.cc';
    const r2 = await fetch('https://mail.aitre.cc/api/emails?email=' + testEmail2);
    console.log('Emails2: ' + r2.status + ' ' + (await r2.text()).substring(0, 200));
  } catch(e) { console.log('FAIL: ' + e.message); }

  console.log("\n=== Dropmail.me API base check ===");
  try {
    // Check if there's a simpler REST API
    const r = await fetch('https://dropmail.me/api/v2/sessions', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: '{}'
    });
    console.log('REST: ' + r.status + ' ' + (await r.text()).substring(0, 200));
  } catch(e) { console.log('FAIL: ' + e.message); }
  
  console.log("\n=== Emailfake.com ===");
  try {
    const r = await fetch('https://emailfake.com');
    console.log('Status: ' + r.status + ' (HTML ' + (await r.text()).length + ' bytes)');
  } catch(e) { console.log('FAIL: ' + e.message); }

  console.log("\n=== Inboxes.com v2 ===");
  try {
    const r = await fetch('https://inboxes.com/api/v2/inbox', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: '{}'
    });
    const data = await r.json();
    console.log('Create: ' + JSON.stringify(data));
    
    // Check messages endpoint - try different paths
    const email = data.inbox;
    const user = email.split('@')[0];
    const dom = email.split('@')[1];
    
    const paths = [
      '/api/v2/inbox/' + user,
      '/api/v2/inbox/' + email,
      '/api/v2/inbox?user=' + user,
    ];
    for (const p of paths) {
      try {
        const r2 = await fetch('https://inboxes.com' + p);
        console.log(p + ': ' + r2.status + ' ' + (await r2.text()).substring(0, 150));
      } catch(e) { console.log(p + ': FAIL'); }
    }
  } catch(e) { console.log('FAIL: ' + e.message); }
}

test().catch(console.error);
