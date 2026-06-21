async function test() {
  const results = [];
  
  // Test 1: MailDrop.cc
  try {
    const r = await fetch('https://api.maildrop.cc/graphql', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({query: '{inbox(mailbox:"testcheck99"){id subject}}'})
    });
    results.push('MailDrop.cc: ' + r.status + ' ' + (await r.text()).substring(0, 200));
  } catch(e) { results.push('MailDrop.cc: FAIL - ' + e.message); }

  // Test 2: Mail.tm
  try {
    const r = await fetch('https://api.mail.tm/domains');
    results.push('Mail.tm: ' + r.status + ' ' + (await r.text()).substring(0, 300));
  } catch(e) { results.push('Mail.tm: FAIL - ' + e.message); }

  // Test 3: Mail.gw
  try {
    const r = await fetch('https://api.mail.gw/domains');
    results.push('Mail.gw: ' + r.status + ' ' + (await r.text()).substring(0, 300));
  } catch(e) { results.push('Mail.gw: FAIL - ' + e.message); }

  // Test 4: Guerrilla Mail
  try {
    const r = await fetch('https://api.guerrillamail.com/ajax.php?f=get_email_address&ip=127.0.0.1&agent=Mozilla/5.0');
    results.push('Guerrilla: ' + r.status + ' ' + (await r.text()).substring(0, 200));
  } catch(e) { results.push('Guerrilla: FAIL - ' + e.message); }

  // Test 5: 1SecMail
  try {
    const r = await fetch('https://www.1secmail.com/api/v1/?action=genRandomMailbox&count=1');
    results.push('1SecMail: ' + r.status + ' ' + (await r.text()).substring(0, 200));
  } catch(e) { results.push('1SecMail: FAIL - ' + e.message); }

  // Test 6: Tempmail.lol
  try {
    const r = await fetch('https://api.tempmail.lol/generate');
    results.push('Tempmail.lol: ' + r.status + ' ' + (await r.text()).substring(0, 200));
  } catch(e) { results.push('Tempmail.lol: FAIL - ' + e.message); }

  // Test 7: temp-mail.io
  try {
    const r = await fetch('https://api.internal.temp-mail.io/api/v3/email/new', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({min_name_length: 10, max_name_length: 10})
    });
    results.push('Temp-mail.io: ' + r.status + ' ' + (await r.text()).substring(0, 200));
  } catch(e) { results.push('Temp-mail.io: FAIL - ' + e.message); }

  // Test 8: Inboxes.com
  try {
    const r = await fetch('https://inboxes.com/api/v2/inbox', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: '{}'
    });
    results.push('Inboxes.com: ' + r.status + ' ' + (await r.text()).substring(0, 200));
  } catch(e) { results.push('Inboxes.com: FAIL - ' + e.message); }

  for (const r of results) console.log(r);
}

test().catch(console.error);
