const fs = require('fs');
const p = 'E:/API获取工具/ZO注册/plugin/zo_register.js';
let c = fs.readFileSync(p, 'utf-8');

// Find the Continue click + wait in Step 3
const oldPattern = '    await new Promise(r => setTimeout(r, 4000));\n\n    // Verify email was sent\n    const pageText = await getBodyText(page, 400);';

if (c.includes(oldPattern)) {
  const newCode = `    // ★ ZO signup submission can take 20+ seconds to process
    for (let wait = 0; wait < 15; wait++) {
      await new Promise(r => setTimeout(r, 2000));
      const checkTxt = await getBodyText(page, 300);
      if (/check your email|login link|we sent/i.test(checkTxt)) break;
      if (wait % 3 === 0) log('  Waiting for submission... (' + ((wait+1)*2) + 's)');
    }

    // Verify email was sent
    const pageText = await getBodyText(page, 400);`;
  
  c = c.replace(oldPattern, newCode);
  fs.writeFileSync(p, c, 'utf-8');
  console.log('Fixed: increased wait time for email submission');
} else {
  console.log('Pattern not found. Searching for nearby code...');
  // Find the line "await new Promise(r => setTimeout(r, 4000));"
  const lines = c.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('setTimeout(r, 4000)')) {
      console.log('Line ' + (i+1) + ': ' + lines[i].trim());
      console.log('  next: ' + (lines[i+1] || '').trim());
      console.log('  next: ' + (lines[i+2] || '').trim());
      console.log('  next: ' + (lines[i+3] || '').trim());
    }
  }
}

try { new Function(fs.readFileSync(p, 'utf-8')); console.log('Syntax OK'); } catch(e) { console.log('Syntax error: ' + e.message); }
