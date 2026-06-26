// Test DropMail.me (fixed) and Inboxes.com message detail
async function test() {
  console.log("=== DropMail.me (GraphQL - FIXED) ===");
  try {
    // Generate token
    const tokenR = await fetch('https://dropmail.me/api/token/generate', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({type: 'af', lifetime: '1h'})
    });
    const tokenData = await tokenR.json();
    const token = tokenData.token;
    console.log('Token: ' + token);
    
    // Create session
    const sessR = await fetch('https://dropmail.me/api/graphql/' + token, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({query: 'mutation { introduceSession(input: {withAddress: true}) { id expiresAt addresses { address restoreKey } } }'})
    });
    const sessData = await sessR.json();
    const session = sessData.data?.introduceSession;
    if (session) {
      const addrs = session.addresses.map(a => a.address);
      console.log('Emails: ' + addrs.join(', '));
      console.log('Session ID: ' + session.id);
      console.log('Expires: ' + session.expiresAt);
      
      // Check inbox
      const inboxR = await fetch('https://dropmail.me/api/graphql/' + token, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({query: '{ session(id: "' + session.id + '") { mails { rawSize fromAddr subject downloadUrl headerSubject text html } } }'})
      });
      const inboxData = await inboxR.json();
      console.log('Inbox: ' + JSON.stringify(inboxData).substring(0, 200));
      console.log('✅ DropMail.me WORKS!');
    }
  } catch(e) { console.log('FAIL: ' + e.message); }

  console.log("\n=== Inboxes.com - message detail test ===");
  try {
    const createR = await fetch('https://inboxes.com/api/v2/inbox', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: '{}'
    });
    const createData = await createR.json();
    const email = createData.inbox;
    const user = email.split('@')[0];
    console.log('Email: ' + email);
    
    // Check inbox
    const inboxR = await fetch('https://inboxes.com/api/v2/inbox/' + user);
    const inboxData = await inboxR.json();
    console.log('Inbox: ' + JSON.stringify(inboxData));
    console.log('✅ Inboxes.com WORKS!');
  } catch(e) { console.log('FAIL: ' + e.message); }
}

test().catch(console.error);
