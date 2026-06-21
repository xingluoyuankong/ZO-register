// Deep test: Tempmail.plus, Nada.email (correct API), and others
async function test() {
  console.log("=== Tempmail.plus ===");
  try {
    // Create email
    const user = 'zotest' + Math.random().toString(36).substring(2, 8);
    const createR = await fetch('https://tempmail.plus/api/mails?email=' + user + '&limit=10');
    console.log('Create: ' + createR.status + ' ' + (await createR.text()).substring(0, 200));
    
    // Check inbox
    const inboxR = await fetch('https://tempmail.plus/api/mails?email=' + user + '@tempmail.plus&limit=10');
    console.log('Inbox: ' + inboxR.status + ' ' + (await inboxR.text()).substring(0, 200));
  } catch(e) { console.log('FAIL: ' + e.message); }

  console.log("\n=== Nada.email / Getnada ===");
  try {
    // Try different API endpoints
    const tests = [
      'https://getnada.com/api/v1/inboxes/testzo99',
      'https://api.getnada.com/v1/inboxes/testzo99',
      'https://getnada.com/api/v1/domains',
    ];
    for (const url of tests) {
      try {
        const r = await fetch(url);
        console.log(url.split('/').slice(3).join('/') + ': ' + r.status + ' ' + (await r.text()).substring(0, 150));
      } catch(e) { console.log(url.split('/').slice(3).join('/') + ': FAIL - ' + e.message); }
    }
  } catch(e) { console.log('FAIL: ' + e.message); }

  console.log("\n=== FakeMail.net (scrape) ===");
  try {
    const r = await fetch('https://www.fakemail.net');
    const html = await r.text();
    // Look for email address in page
    const emailMatch = html.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
    if (emailMatch) {
      console.log('Email found: ' + emailMatch[1]);
      // Try to check inbox
      const mb = emailMatch[1].split('@')[0];
      const dom = emailMatch[1].split('@')[1];
      const inboxR = await fetch('https://www.fakemail.net/inbox/' + mb + '/' + dom);
      console.log('Inbox: ' + inboxR.status);
    } else {
      console.log('No email found in HTML (' + html.length + ' bytes)');
      // Try extracting from specific elements
      const dataMatch = html.match(/data-email=["']([^"']+)["']/);
      if (dataMatch) console.log('data-email: ' + dataMatch[1]);
    }
  } catch(e) { console.log('FAIL: ' + e.message); }

  console.log("\n=== Mohmal ===");
  try {
    // Mohmal requires POST to create email
    const createR = await fetch('https://www.mohmal.com/en/create', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Requested-With': 'XMLHttpRequest',
      },
    });
    console.log('Create: ' + createR.status + ' ' + (await createR.text()).substring(0, 200));
  } catch(e) { console.log('FAIL: ' + e.message); }

  console.log("\n=== MinuteInbox ===");
  try {
    const r = await fetch('https://www.minuteinbox.com/index/index', {
      headers: {
        'X-Requested-With': 'XMLHttpRequest',
        'Accept': 'application/json',
      },
    });
    const text = await r.text();
    console.log('Index: ' + r.status + ' ' + text.substring(0, 200));
    
    // Try to find email
    const emailMatch = text.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
    if (emailMatch) console.log('Email: ' + emailMatch[1]);
  } catch(e) { console.log('FAIL: ' + e.message); }

  // Now test Nada.email with correct API from getnada.com
  console.log("\n=== Getnada.com correct API ===");
  try {
    const r1 = await fetch('https://getnada.com/api/v1/domains');
    console.log('domains: ' + r1.status + ' ' + (await r1.text()).substring(0, 200));
    
    const user = 'zotest' + Math.random().toString(36).substring(2, 8);
    const r2 = await fetch('https://getnada.com/api/v1/inboxes/' + user);
    console.log('inbox: ' + r2.status + ' ' + (await r2.text()).substring(0, 200));
  } catch(e) { console.log('FAIL: ' + e.message); }
}

test().catch(console.error);
