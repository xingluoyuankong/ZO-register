/**
 * temp_mail.js — 免费临时邮箱服务整合模块
 * 
 * 支持 8 个免费服务（无需 API Key，中国大陆可用）：
 * 1. MailDrop.cc    - @maildrop.cc        (GraphQL, 无需创建账号)
 * 2. Mail.tm        - @web-library.net    (REST, JWT)
 * 3. Mail.gw        - @oakon.com 等       (REST, JWT)
 * 4. Guerrilla Mail - @guerrillamailblock.com (SID)
 * 5. Temp-mail.io   - 多域名               (Token)
 * 6. Tempmail.plus  - @tempmail.plus       (REST, 无需创建)
 * 7. DropMail.me    - @maximail.fyi 等     (GraphQL + token)
 * 8. Inboxes.com    - @dropjar.com 等      (REST)
 * 
 * 使用方式：
 *   const tm = require('./temp_mail');
 *   const { email, provider, credentials } = await tm.createEmail();
 *   const result = await tm.pollInbox(email, credentials, { keyword: 'zo.computer', timeout: 120 });
 */

const PROVIDERS = ['maildrop', 'mailtm', 'mailgw', 'guerrilla', 'tempmailio', 'tempmailplus', 'dropmailme', 'inboxes', 'catchmail'];

// ==================== MailDrop.cc ====================
class MailDropProvider {
  constructor() { this.name = 'MailDrop.cc'; }
  
  async create() {
    const user = 'zo' + this._rand(10);
    const email = user + '@maildrop.cc';
    return { email, credentials: { mailbox: user }, provider: 'maildrop' };
  }

  async getMessages(credentials) {
    const r = await fetch('https://api.maildrop.cc/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: `{inbox(mailbox:"${credentials.mailbox}"){id subject mailfrom date}}`
      })
    });
    const data = await r.json();
    return (data.data?.inbox || []).map(m => ({
      id: m.id, subject: m.subject || '', from: m.mailfrom || '', date: m.date || ''
    }));
  }

  async getMessageDetail(credentials, messageId) {
    const sid = String(messageId).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const mb = credentials.mailbox.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const r = await fetch('https://api.maildrop.cc/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: `{message(mailbox:"${mb}",id:"${sid}"){id subject mailfrom date data html}}`
      })
    });
    const data = await r.json();
    const msg = data.data?.message;
    if (!msg) return null;
    return { id: msg.id, subject: msg.subject || '', from: msg.mailfrom || '',
      text: msg.data || '', html: msg.html || '' };
  }
  _rand(len) { const c='abcdefghijklmnopqrstuvwxyz0123456789'; return Array.from({length:len},()=>c[Math.floor(Math.random()*c.length)]).join(''); }
}

// ==================== Mail.tm / Mail.gw ====================
class MailTmProvider {
  constructor(base, name) { this.base = base; this.name = name; }
  async create() {
    const domR = await fetch(this.base + '/domains');
    const domData = await domR.json();
    const members = domData['hydra:member'] || [];
    if (!members.length) throw new Error('No domains');
    const domain = members[0].domain;
    const user = 'zotest' + this._rand(8);
    const addr = user + '@' + domain;
    const pwd = 'Zo' + this._rand(8) + '!@#';
    const createR = await fetch(this.base + '/accounts', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({address: addr, password: pwd})
    });
    if (createR.status !== 201) throw new Error('Create: ' + createR.status);
    const tokenR = await fetch(this.base + '/token', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({address: addr, password: pwd})
    });
    const tokenData = await tokenR.json();
    return { email: addr, credentials: {token: tokenData.token}, provider: this.name === 'Mail.tm' ? 'mailtm' : 'mailgw' };
  }
  async getMessages(credentials) {
    const r = await fetch(this.base + '/messages', { headers: {'Authorization': 'Bearer ' + credentials.token} });
    const data = await r.json();
    return (data['hydra:member'] || []).map(m => ({id: m.id, subject: m.subject || '', from: m.from?.address || '', date: m.createdAt || ''}));
  }
  async getMessageDetail(credentials, messageId) {
    const r = await fetch(this.base + '/messages/' + messageId, { headers: {'Authorization': 'Bearer ' + credentials.token} });
    if (r.status !== 200) return null;
    const msg = await r.json();
    return { id: msg.id, subject: msg.subject || '', from: msg.from?.address || '',
      text: msg.text || '', html: msg.html?.join('') || msg.text || '' };
  }
  _rand(len) { const c='abcdefghijklmnopqrstuvwxyz0123456789'; return Array.from({length:len},()=>c[Math.floor(Math.random()*c.length)]).join(''); }
}

// ==================== Guerrilla Mail ====================
class GuerrillaProvider {
  constructor() { this.name = 'Guerrilla Mail'; }
  async create() {
    const r = await fetch('https://api.guerrillamail.com/ajax.php?f=get_email_address&ip=127.0.0.1&agent=Mozilla/5.0');
    const data = await r.json();
    return { email: data.email_addr, credentials: {sid: data.sid_token}, provider: 'guerrilla' };
  }
  async getMessages(credentials) {
    const r = await fetch('https://api.guerrillamail.com/ajax.php?f=check_email&seq=0&sid_token=' + credentials.sid);
    const data = await r.json();
    return (data.list || []).map(m => ({id: m.mail_id, subject: m.mail_subject || '', from: m.mail_from || '', date: m.mail_date || ''}));
  }
  async getMessageDetail(credentials, messageId) {
    const r = await fetch('https://api.guerrillamail.com/ajax.php?f=fetch_email&email_id=' + messageId + '&sid_token=' + credentials.sid);
    const msg = await r.json();
    return { id: msg.mail_id || messageId, subject: msg.mail_subject || '', from: msg.mail_from || '',
      text: msg.mail_body || '', html: msg.mail_html || msg.mail_body || '' };
  }
}

// ==================== Temp-mail.io ====================
class TempMailIOProvider {
  constructor() { this.name = 'Temp-mail.io'; }
  async create() {
    const r = await fetch('https://api.internal.temp-mail.io/api/v3/email/new', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({min_name_length: 10, max_name_length: 10})
    });
    const data = await r.json();
    return { email: data.email, credentials: {token: data.token, email: data.email}, provider: 'tempmailio' };
  }
  async getMessages(credentials) {
    const r = await fetch('https://api.internal.temp-mail.io/api/v3/email/' + credentials.token + '/messages');
    if (r.status !== 200) return [];
    const data = await r.json();
    return (Array.isArray(data) ? data : []).map(m => ({
      id: m.id || m._id || String(Math.random()), subject: m.subject || '',
      from: m.from || m.sender || '', date: m.created_at || ''
    }));
  }
  async getMessageDetail(credentials, messageId) {
    const r = await fetch('https://api.internal.temp-mail.io/api/v3/message/' + messageId);
    if (r.status !== 200) return null;
    const msg = await r.json();
    return { id: msg.id || messageId, subject: msg.subject || '', from: msg.from || '',
      text: msg.body_text || msg.body || '', html: msg.body_html || msg.html || msg.body || '' };
  }
}

// ==================== Tempmail.plus ====================
class TempMailPlusProvider {
  constructor() { this.name = 'Tempmail.plus'; }
  async create() {
    const user = 'zo' + this._rand(10);
    const email = user + '@tempmail.plus';
    return { email, credentials: {email: email, user: user}, provider: 'tempmailplus' };
  }
  async getMessages(credentials) {
    const r = await fetch('https://tempmail.plus/api/mails?email=' + encodeURIComponent(credentials.email) + '&limit=10');
    const data = await r.json();
    return (data.mail_list || []).map(m => ({
      id: m.mail_id || String(m.id || ''), subject: m.subject || '',
      from: m.from || m.mail_from || '', date: m.time || ''
    }));
  }
  async getMessageDetail(credentials, messageId) {
    const r = await fetch('https://tempmail.plus/api/mails/' + messageId + '?email=' + encodeURIComponent(credentials.email));
    if (r.status !== 200) return null;
    const msg = await r.json();
    return { id: messageId, subject: msg.subject || '', from: msg.from || '',
      text: msg.text || '', html: msg.html || msg.text || '' };
  }
  _rand(len) { const c='abcdefghijklmnopqrstuvwxyz0123456789'; return Array.from({length:len},()=>c[Math.floor(Math.random()*c.length)]).join(''); }
}

// ==================== DropMail.me (GraphQL) ====================
class DropMailMeProvider {
  constructor() { this.name = 'DropMail.me'; }
  async create() {
    // Get token
    const tokenR = await fetch('https://dropmail.me/api/token/generate', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({type: 'af', lifetime: '1h'})
    });
    const tokenData = await tokenR.json();
    const token = tokenData.token;
    if (!token) throw new Error('No token');
    
    // Create session
    const sessR = await fetch('https://dropmail.me/api/graphql/' + token, {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({query: 'mutation { introduceSession(input: {withAddress: true}) { id expiresAt addresses { address restoreKey } } }'})
    });
    const sessData = await sessR.json();
    const session = sessData.data?.introduceSession;
    if (!session || !session.addresses?.length) throw new Error('No session');
    
    const email = session.addresses[0].address;
    return { email, credentials: {token, sessionId: session.id}, provider: 'dropmailme' };
  }
  async getMessages(credentials) {
    const r = await fetch('https://dropmail.me/api/graphql/' + credentials.token, {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({query: '{ session(id: "' + credentials.sessionId + '") { mails { headerSubject headerFrom rawSize } } }'})
    });
    const data = await r.json();
    return (data.data?.session?.mails || []).map((m, i) => ({
      id: String(i), subject: m.headerSubject || '', from: m.headerFrom || '', date: ''
    }));
  }
  async getMessageDetail(credentials, messageId) {
    const r = await fetch('https://dropmail.me/api/graphql/' + credentials.token, {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({query: '{ session(id: "' + credentials.sessionId + '") { mails { headerSubject headerFrom rawSize text html } } }'})
    });
    const data = await r.json();
    const mails = data.data?.session?.mails || [];
    const idx = parseInt(messageId) || 0;
    const msg = mails[idx];
    if (!msg) return null;
    return { id: messageId, subject: msg.headerSubject || '', from: msg.headerFrom || '',
      text: msg.text || '', html: msg.html || msg.text || '' };
  }
}

// ==================== Inboxes.com ====================
class InboxesProvider {
  constructor() { this.name = 'Inboxes.com'; }
  async create() {
    const r = await fetch('https://inboxes.com/api/v2/inbox', {
      method: 'POST', headers: {'Content-Type':'application/json'}, body: '{}'
    });
    const data = await r.json();
    const email = data.inbox;
    if (!email) throw new Error('No inbox');
    const user = email.split('@')[0];
    return { email, credentials: {user, email}, provider: 'inboxes' };
  }
  async getMessages(credentials) {
    const r = await fetch('https://inboxes.com/api/v2/inbox/' + credentials.user);
    const data = await r.json();
    return (data.msgs || []).map(m => ({
      id: m.id || String(Math.random()), subject: m.s || m.subject || '',
      from: m.f || m.from || '', date: m.t || m.date || ''
    }));
  }
  async getMessageDetail(credentials, messageId) {
    // Inboxes.com returns message content in the list endpoint
    const r = await fetch('https://inboxes.com/api/v2/inbox/' + credentials.user);
    const data = await r.json();
    const msg = (data.msgs || []).find(m => String(m.id) === String(messageId));
    if (!msg) return null;
    return { id: messageId, subject: msg.s || msg.subject || '', from: msg.f || msg.from || '',
      text: msg.p || msg.preview || msg.text || '', html: msg.h || msg.html || msg.p || '' };
  }
}

// ==================== Catchmail.io ====================
class CatchmailProvider {
  constructor() { this.name = 'Catchmail.io'; }
  async create() {
    const user = 'zo' + this._rand(10);
    const email = user + '@catchmail.io';
    return { email, credentials: {email: email, user: user}, provider: 'catchmail' };
  }
  async getMessages(credentials) {
    const r = await fetch('https://api.catchmail.io/api/v1/mailbox?address=' + encodeURIComponent(credentials.email));
    const data = await r.json();
    return (data.messages || []).map(m => ({
      id: m.id || String(m.message_id || ''), subject: m.subject || '',
      from: m.from || m.sender || '', date: m.date || ''
    }));
  }
  async getMessageDetail(credentials, messageId) {
    const r = await fetch('https://api.catchmail.io/api/v1/message/' + messageId + '?mailbox=' + encodeURIComponent(credentials.email));
    if (r.status !== 200) return null;
    const msg = await r.json();
    const body = msg.body || {};
    return { id: messageId, subject: msg.subject || '', from: msg.from || '',
      text: body.text || msg.text || '', html: body.html || msg.html || body.text || '' };
  }
  _rand(len) { const c='abcdefghijklmnopqrstuvwxyz0123456789'; return Array.from({length:len},()=>c[Math.floor(Math.random()*c.length)]).join(''); }
}

// ==================== Provider Registry ====================
function getProvider(name) {
  switch (name) {
    case 'maildrop': return new MailDropProvider();
    case 'mailtm': return new MailTmProvider('https://api.mail.tm', 'Mail.tm');
    case 'mailgw': return new MailTmProvider('https://api.mail.gw', 'Mail.gw');
    case 'guerrilla': return new GuerrillaProvider();
    case 'tempmailio': return new TempMailIOProvider();
    case 'tempmailplus': return new TempMailPlusProvider();
    case 'dropmailme': return new DropMailMeProvider();
    case 'inboxes': return new InboxesProvider();
    case 'catchmail': return new CatchmailProvider();
    default: throw new Error('Unknown provider: ' + name);
  }
}

// ==================== Public API ====================
async function createEmail(opts = {}) {
  const log = opts.log || (() => {});
  const providerList = opts.provider ? [opts.provider] : (opts.providers || PROVIDERS);
  for (const name of providerList) {
    try {
      const p = getProvider(name);
      log('[TEMP-MAIL] Trying ' + p.name + '...');
      const result = await p.create();
      log('[TEMP-MAIL] ✅ ' + p.name + ': ' + result.email);
      return { ...result, providerInstance: p };
    } catch (e) {
      log('[TEMP-MAIL] ❌ ' + name + ': ' + e.message);
    }
  }
  throw new Error('All temp mail providers failed');
}

async function pollInbox(email, credentials, opts = {}) {
  const log = opts.log || (() => {});
  const keyword = opts.keyword || '';
  const timeout = (opts.timeout || 120) * 1000;
  const interval = opts.interval || 3000;
  const linkFilter = opts.linkFilter || null;
  const provider = opts.providerInstance || getProvider(opts.provider || 'maildrop');
  const seen = new Set();
  const deadline = Date.now() + timeout;
  let pollCount = 0;
  
  log('[POLL] Started for ' + email + ', keyword=' + (keyword || '*'));
  
  while (Date.now() < deadline) {
    pollCount++;
    try {
      const messages = await provider.getMessages(credentials);
      if (pollCount <= 3 || pollCount % 5 === 0) log('[POLL] #' + pollCount + ' getMessages returned ' + messages.length + ' msgs');
      for (const msg of messages) {
        if (seen.has(msg.id)) continue;
        seen.add(msg.id);
        const matchText = (msg.subject + ' ' + msg.from).toLowerCase();
        if (keyword && !matchText.includes(keyword.toLowerCase())) {
          log('[POLL] #' + pollCount + ' New mail (skip): ' + msg.subject.substring(0, 50));
          continue;
        }
        log('[POLL] #' + pollCount + ' Found: "' + msg.subject.substring(0, 60) + '" from ' + msg.from);
        const detail = await provider.getMessageDetail(credentials, msg.id);
        if (!detail) continue;
        const combined = (detail.html || '') + ' ' + (detail.text || '');
        const links = extractLinks(combined, linkFilter);
        log('[POLL] ✅ Links: ' + links.length);
        return { message: detail, links, messageDetail: detail };
      }
    } catch (e) {
      log('[POLL] Error: ' + e.message);
    }
    if (pollCount % 5 === 0) {
      const remaining = Math.round((deadline - Date.now()) / 1000);
      log('[POLL] #' + pollCount + ', ' + remaining + 's remaining');
    }
    await sleep(interval);
  }
  throw new Error('Poll timeout (' + opts.timeout + 's) for ' + email);
}

function extractLinks(text, filter) {
  const links = new Set();
  const hrefs = text.match(/href=["']([^"']+)["']/gi) || [];
  for (const h of hrefs) { const u = h.replace(/^href=["']/i,'').replace(/["']$/,''); if (u.startsWith('http')) links.add(u); }
  const raws = text.match(/https?:\/\/[^\s"'<>]+/gi) || [];
  for (const u of raws) links.add(u.replace(/[)\]>,;!?\s]+$/, ''));
  let result = [...links];
  if (filter) result = result.filter(filter);
  return result;
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

module.exports = {
  createEmail, pollInbox, extractLinks, getProvider, PROVIDERS,
  MailDropProvider, MailTmProvider, GuerrillaProvider, TempMailIOProvider,
  TempMailPlusProvider, DropMailMeProvider, InboxesProvider, CatchmailProvider,
};
