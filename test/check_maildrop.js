// Quick check: poll maildrop.cc inbox for a specific email
const tempMail = require("./temp_mail");

async function main() {
  const email = "zo17sbj3devp@maildrop.cc";
  const mailbox = email.split('@')[0];
  
  console.log("Checking inbox for: " + email);
  console.log("Mailbox: " + mailbox);
  
  const provider = new tempMail.MailDropProvider();
  const credentials = { mailbox };
  
  // Poll 5 times with 5 second intervals
  for (let i = 0; i < 5; i++) {
    console.log("\n--- Poll #" + (i+1) + " ---");
    try {
      const messages = await provider.getMessages(credentials);
      console.log("Messages: " + messages.length);
      for (const msg of messages) {
        console.log("  ID: " + msg.id);
        console.log("  Subject: " + msg.subject);
        console.log("  From: " + msg.from);
        console.log("  Date: " + msg.date);
        
        // Get detail
        const detail = await provider.getMessageDetail(credentials, msg.id);
        if (detail) {
          console.log("  Text length: " + (detail.text || '').length);
          console.log("  HTML length: " + (detail.html || '').length);
          console.log("  Text preview: " + (detail.text || '').substring(0, 200));
        }
      }
    } catch(e) {
      console.log("Error: " + e.message);
    }
    if (i < 4) await new Promise(r => setTimeout(r, 5000));
  }
}

main().catch(console.error);
