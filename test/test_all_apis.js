// Batch test ALL temp email APIs including ones from any-auto-register
async function test() {
  const results = [];
  
  const tests = [
    // === Already tested (5 working) ===
    {name:'MailDrop.cc', fn: async()=>{
      const r = await fetch('https://api.maildrop.cc/graphql',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query:'{inbox(mailbox:"test99"){id}}'})});
      return r.status + ' ' + (await r.text()).substring(0,80);
    }},
    {name:'Mail.tm', fn: async()=>{
      const r = await fetch('https://api.mail.tm/domains');
      return r.status + ' ' + (await r.text()).substring(0,120);
    }},
    {name:'Mail.gw', fn: async()=>{
      const r = await fetch('https://api.mail.gw/domains');
      return r.status + ' ' + (await r.text()).substring(0,120);
    }},
    {name:'Guerrilla', fn: async()=>{
      const r = await fetch('https://api.guerrillamail.com/ajax.php?f=get_email_address&ip=127.0.0.1&agent=Mozilla/5.0');
      return r.status + ' ' + (await r.text()).substring(0,120);
    }},
    {name:'Temp-mail.io', fn: async()=>{
      const r = await fetch('https://api.internal.temp-mail.io/api/v3/email/new',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({min_name_length:10,max_name_length:10})});
      return r.status + ' ' + (await r.text()).substring(0,120);
    }},
    
    // === NEW: From any-auto-register ===
    // Nada.email / Getnada
    {name:'Nada.email', fn: async()=>{
      const r = await fetch('https://getnada.com/api/v1/domains');
      return r.status + ' ' + (await r.text()).substring(0,150);
    }},
    
    // Mailpoof
    {name:'Mailpoof', fn: async()=>{
      const r = await fetch('https://api.mailpoof.com/v1/domains');
      return r.status + ' ' + (await r.text()).substring(0,150);
    }},
    
    // FakeMail.net
    {name:'FakeMail.net', fn: async()=>{
      const r = await fetch('https://www.fakemail.net');
      return r.status + ' (HTML ' + (await r.text()).length + ' bytes)';
    }},
    
    // Tempmail.org
    {name:'Tempmail.org', fn: async()=>{
      const r = await fetch('https://api.tempmail.org/api/v2/inbox');
      return r.status + ' ' + (await r.text()).substring(0,150);
    }},
    
    // 10minutemail
    {name:'10MinuteMail', fn: async()=>{
      const r = await fetch('https://10minutemail.com/session/address');
      return r.status + ' ' + (await r.text()).substring(0,150);
    }},
    
    // Tempmail.plus
    {name:'Tempmail.plus', fn: async()=>{
      const r = await fetch('https://tempmail.plus/api/mails?limit=10');
      return r.status + ' ' + (await r.text()).substring(0,150);
    }},
    
    // Minuteinbox
    {name:'MinuteInbox', fn: async()=>{
      const r = await fetch('https://www.minuteinbox.com/index/index');
      return r.status + ' ' + (await r.text()).substring(0,150);
    }},
    
    // Emailnax
    {name:'Emailnax', fn: async()=>{
      const r = await fetch('https://emailnax.com/api/generate');
      return r.status + ' ' + (await r.text()).substring(0,150);
    }},
    
    // Mohmal
    {name:'Mohmal', fn: async()=>{
      const r = await fetch('https://www.mohmal.com/en');
      return r.status + ' (HTML ' + (await r.text()).length + ' bytes)';
    }},
    
    // Yopmail
    {name:'Yopmail', fn: async()=>{
      const r = await fetch('https://yopmail.com/en/');
      return r.status + ' (HTML ' + (await r.text()).length + ' bytes)';
    }},
    
    // Disposable.id
    {name:'Disposable.id', fn: async()=>{
      const r = await fetch('https:// disposable.id/api/random');
      return r.status + ' ' + (await r.text()).substring(0,150);
    }},
    
    // Mailnesia
    {name:'Mailnesia', fn: async()=>{
      const r = await fetch('https://mailnesia.com/api/v1/mailbox/testzo99');
      return r.status + ' ' + (await r.text()).substring(0,150);
    }},
    
    // Harakirimail
    {name:'Harakirimail', fn: async()=>{
      const r = await fetch('https://harakirimail.com/api/inbox/testzo99');
      return r.status + ' ' + (await r.text()).substring(0,150);
    }},
    
    // ThrowAwayMail
    {name:'ThrowAwayMail', fn: async()=>{
      const r = await fetch('https://www.throwawaymail.com/en');
      return r.status + ' (HTML ' + (await r.text()).length + ' bytes)';
    }},
    
    // Crazymailing
    {name:'Crazymailing', fn: async()=>{
      const r = await fetch('https://www.crazymailing.com/');
      return r.status + ' (HTML ' + (await r.text()).length + ' bytes)';
    }},

    // Internxt (disposable email)
    {name:'Internxt', fn: async()=>{
      const r = await fetch('https://temp-mail.internxt.com/api/address/new',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
      return r.status + ' ' + (await r.text()).substring(0,150);
    }},
    
    // Dispostable
    {name:'Dispostable', fn: async()=>{
      const r = await fetch('https://www.dispostable.com/api/inbox/testzo99');
      return r.status + ' ' + (await r.text()).substring(0,150);
    }},
  ];
  
  for (const t of tests) {
    try {
      const result = await Promise.race([t.fn(), new Promise((_,rej)=>setTimeout(()=>rej('timeout'),8000))]);
      console.log(t.name.padEnd(16) + ': ' + result);
    } catch(e) { console.log(t.name.padEnd(16) + ': FAIL - ' + e); }
  }
}

test().catch(console.error);
