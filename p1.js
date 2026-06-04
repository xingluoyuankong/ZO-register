const fs=require('fs'),p=require('puppeteer-extra');
p.use(require('puppeteer-extra-plugin-stealth')());
const s=ms=>new Promise(r=>setTimeout(r,ms));
const F='/home/workspace/extracted_emails/bushuozaijian2026@outlook.com.txt';
const [E,,C,R]=fs.readFileSync(F,'utf8').trim().split('----').map(x=>x.trim());
(async()=>{
const B=await p.launch({headless:false,args:['--no-sandbox']});
const P=(await B.pages())[0];
await P.goto('https://www.zo.computer/signup',{waitUntil:'domcontentloaded',timeout:30000});
await s(3000);
await P.evaluate(()=>{for(let b of document.querySelectorAll('''button'''))if(/Email me a sign-up link/i.test(b.textContent)){b.click();return}});
await s(3000);
await P.evaluate(e=>{let i=document.querySelector('''input[type=email]''');if(i){let v=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'''value''').set;v.call(i,e);i.dispatchEvent(new Event('''input''',{bubbles:true}));}},E);
await s(500);
await P.evaluate(()=>{for(let b of document.querySelectorAll('''button'''))if(b.textContent.trim()==='''Continue'''){b.click();return}});
await s(5000);
const T0=Date.now();
for(let i=0;i<36;i++){await s(5000);
try{let t=await(await fetch('''https://login.microsoftonline.com/consumers/oauth2/v2.0/token''',{method:'''POST''',headers:{'''Content-Type''':'''application/x-www-form-urlencoded'''},body:new URLSearchParams({client_id:C,grant_type:'''refresh_token''',refresh_token:R,scope:'''https://graph.microsoft.com/.default offline_access'''}).toString()})).json();
if(!t.access_token)continue;
let m=await(await fetch('''https://graph.microsoft.com/v1.0/me/messages?\=5&\=subject,body,receivedDateTime&\=receivedDateTime desc''',{headers:{Authorization:'''Bearer '''+t.access_token}})).json();
for(let msg of(m.value||[])){if(new Date(msg.receivedDateTime).getTime()<T0-30000)continue;let h=(msg.body&&msg.body.content)||'''';let l=h.match(/https:\/\/www\.zo\.computer\/api\/email-login\/verify[^\s"'''<>]*/i);if(l){let link=l[0].replace(/&amp;/g,'''&''');fs.writeFileSync('''/tmp/zo-magic-link.txt''',link);console.log('''LINK:'''+link);await B.close();process.exit(0)}}}process.stdout.write('''.''')}catch(e){process.stdout.write('''x''')}}
process.exit(1)
})()