const tm = require('./temp_mail.js');
async function test() {
  for (const p of tm.PROVIDERS) {
    try {
      const result = await tm.createEmail({provider: p, log: console.log});
      console.log('  => ' + result.email);
    } catch(e) {
      console.log('  FAIL: ' + e.message);
    }
  }
}
test().catch(console.error);
