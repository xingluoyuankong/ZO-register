// Test inbox reading for each working provider
async function test() {
  console.log('=== Testing Inbox Read ===\n');

  // 1. MailDrop.cc - read inbox (no account creation needed, just query)
  console.log('--- MailDrop.cc ---');
  try {
    const mb = 'zotest' + Math.random().toString(36).substring(2, 8);
    const email = mb + '@maildrop.cc';
    console.log('Email: ' + email);
    const r = await fetch('https://api.maildrop.cc/graphql', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({query: '{inbox(mailbox:"'+mb+'"){id subject mailfrom date}}'})
    });
    console.log('Inbox: ' + (await r.text()).substring(0, 300));
  } catch(e) { console.log('FAIL: ' + e.message); }

  // 2. Mail.tm - create account + check inbox
  console.log('\n--- Mail.tm ---');
  try {
    const domR = await fetch('https://api.mail.tm/domains');
    const domData = await domR.json();
    const domain = domData['hydra:member'][0].domain;
    const user = 'zotest' + Math.random().toString(36).substring(2, 10);
    const addr = user + '@' + domain;
    const pwd = 'ZoTest123!@#';
    
    const createR = await fetch('https://api.mail.tm/accounts', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({address: addr, password: pwd})
    });
    console.log('Create: ' + createR.status);
    
    if (createR.status === 201) {
      const tokenR = await fetch('https://api.mail.tm/token', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({address: addr, password: pwd})
      });
      const tokenData = await tokenR.json();
      console.log('Token: ' + (tokenData.token || '').substring(0, 30) + '...');
      
      const msgR = await fetch('https://api.mail.tm/messages', {
        headers: {'Authorization': 'Bearer ' + tokenData.token}
      });
      console.log('Messages: ' + msgR.status + ' ' + (await msgR.text()).substring(0, 200));
      console.log('Email: ' + addr);
    } else {
      console.log('Create failed: ' + (await createR.text()).substring(0, 200));
    }
  } catch(e) { console.log('FAIL: ' + e.message); }

  // 3. Guerrilla Mail - check inbox
  console.log('\n--- Guerrilla Mail ---');
  try {
    const sidR = await fetch('https://api.guerrillamail.com/ajax.php?f=get_email_address&ip=127.0.0.1&agent=Mozilla/5.0');
    const sidData = await sidR.json();
    const email = sidData.email_addr;
    const sid = sidData.sid_token;
    console.log('Email: ' + email);
    console.log('SID: ' + sid);
    
    const msgR = await fetch('https://api.guerrillamail.com/ajax.php?f=check_email&seq=0&sid_token=' + sid);
    const msgData = await msgR.json();
    console.log('Messages: ' + JSON.stringify(msgData).substring(0, 300));
  } catch(e) { console.log('FAIL: ' + e.message); }

  // 4. Temp-mail.io - check inbox
  console.log('\n--- Temp-mail.io ---');
  try {
    const createR = await fetch('https://api.internal.temp-mail.io/api/v3/email/new', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({min_name_length: 10, max_name_length: 10})
    });
    const createData = await createR.json();
    const email = createData.email;
    const token = createData.token;
    console.log('Email: ' + email);
    
    const msgR = await fetch('https://api.internal.temp-mail.io/api/v3/email/' + email + '/messages');
    console.log('Messages: ' + msgR.status + ' ' + (await msgR.text()).substring(0, 300));
  } catch(e) { console.log('FAIL: ' + e.message); }

  // 5. Inboxes.com - check inbox
  console.log('\n--- Inboxes.com ---');
  try {
    const createR = await fetch('https://inboxes.com/api/v2/inbox', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: '{}'
    });
    const createData = await createR.json();
    const email = createData.inbox;
    console.log('Email: ' + email);
    
    // Try checking messages
    const mb = email.split('@')[0];
    const msgR = await fetch('https://inboxes.com/api/v2/inbox/' + mb + '/messages');
    console.log('Messages: ' + msgR.status + ' ' + (await msgR.text()).substring(0, 300));
  } catch(e) { console.log('FAIL: ' + e.message); }

  // 6. Mail.gw - same API as mail.tm
  console.log('\n--- Mail.gw ---');
  try {
    const domR = await fetch('https://api.mail.gw/domains');
    const domData = await domR.json();
    const domain = domData['hydra:member'][0].domain;
    const user = 'zotest' + Math.random().toString(36).substring(2, 10);
    const addr = user + '@' + domain;
    const pwd = 'ZoTest123!@#';
    
    const createR = await fetch('https://api.mail.gw/accounts', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({address: addr, password: pwd})
    });
    console.log('Create: ' + createR.status);
    if (createR.status === 201) {
      const tokenR = await fetch('https://api.mail.gw/token', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({address: addr, password: pwd})
      });
      const tokenData = await tokenR.json();
      const msgR = await fetch('https://api.mail.gw/messages', {
        headers: {'Authorization': 'Bearer ' + tokenData.token}
      });
      console.log('Messages: ' + msgR.status);
      console.log('Email: ' + addr);
    }
  } catch(e) { console.log('FAIL: ' + e.message); }
}

test().catch(console.error);
