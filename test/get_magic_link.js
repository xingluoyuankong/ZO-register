const imaps = require("imap-simple");
const { simpleParser } = require("mailparser");

async function main() {
  const conn = new imaps({
    imap: { user: "hendricktamm95v80awzaxli@outlook.com", password: "Xxzvh@2026Secure#", host: "outlook.office365.com", port: 993, tls: true, authTimeout: 30000 }
  });
  await conn.openBox("INBOX");
  const msgs = await conn.search(["ALL"], { bodies: [""], markSeen: false });
  const latest = msgs.slice(-10);
  for (const msg of latest.reverse()) {
    const full = await simpleParser(msg.parts[0].body);
    const combined = (full.text || "") + " " + (full.html || "");
    const from = full.headers ? (full.headers.get ? full.headers.get("from") : full.headers["from"]) : "";
    if (/no-reply@zocomputer\.com/i.test(String(from))) {
      const m = combined.match(/https:\/\/www\.zocomputer\.com\/api\/email-login\/verify[^\s"'<>]+/i);
      if (m) { console.log(m[0]); process.exit(0); }
    }
  }
  process.exit(1);
}
main().catch(e => { console.error(e.message); process.exit(1); });
