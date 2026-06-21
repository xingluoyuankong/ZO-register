const fs = require('fs');
const lines = fs.readFileSync("C:\\Users\\XZXyuan\\Downloads\\100个Outlook邮箱.txt", "utf8").split("\n").filter(l => l.trim());

let bad = 0, ok = 0;
for (const l of lines) {
  const p = l.split("----");
  if (p[2] && p[2].trim().startsWith("-")) bad++;
  else ok++;
}
console.log("With ---- split: OK=" + ok + " BAD=" + bad);

let fix = 0;
for (const l of lines) {
  const p = l.split(/-{3,}/);
  if (p[2] && p[2].trim().length === 36 && !p[2].trim().startsWith("-")) fix++;
}
console.log("With regex split: OK=" + fix + "/" + lines.length);

// Check for duplicate emails
const seen = new Set();
let dups = 0;
for (const l of lines) {
  const p = l.split(/-{3,}/);
  const email = p[0]?.trim();
  if (seen.has(email)) dups++;
  seen.add(email);
}
console.log("Unique emails: " + seen.size + " (dups: " + dups + ")");
