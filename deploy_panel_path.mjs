/**
 * 把保活面板部署到 ZO子域名/keepalive 路径下
 * 方法: 查ZO的nginx → 加反向代理规则 → localhost:3000
 */
import { readFileSync, appendFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXT_DIR = join(__dirname, 'ext-crack');
const LOG_DIR = join(__dirname, 'logs', 'panel_path');
const ACCOUNTS_FILE = join(__dirname, 'keepalive', 'accounts.json');
if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));
const now = () => new Date().toISOString();
const log = msg => { const m = `[${now()}] ${msg}`; console.log(m); appendFileSync(join(LOG_DIR, 'log.txt'), m + '\n'); };
const rand = (a,b) => Math.floor(a+Math.random()*(b-a+1));
const seval = (page, fn, ...args) => page.evaluate(fn, ...args).catch(e=>{});

const accounts = JSON.parse(readFileSync(ACCOUNTS_FILE, 'utf-8'));
const acc = accounts[0];

async function getMsToken(cid, rt) {
  const b = new URLSearchParams({ client_id: cid, grant_type: 'refresh_token', refresh_token: rt, scope: 'https://graph.microsoft.com/.default offline_access' });
  const r = await fetch('https://login.microsoftonline.com/consumers/oauth2/v2.0/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: b.toString() });
  const d = await r.json(); if (d.error) throw new Error(d.error_description);
  return { at: d.access_token, rt: d.refresh_token || rt };
}
async function findLink(at, after) {
  const r = await fetch('https://graph.microsoft.com/v1.0/me/messages?$top=10&$select=subject,body,receivedDateTime&$orderby=receivedDateTime%20desc', { headers: { Authorization: 'Bearer ' + at } });
  const d = await r.json(); for (const m of (d.value || [])) { if (new Date(m.receivedDateTime)<after) continue; const c=(m.subject||'')+' '+(m.body?.content||''); if(!/zo/i.test(c)) continue; const links=c.match(/https?:\/\/[^\s"'<>]*zo\.computer[^\s"'<>]*/gi)||[]; for(let l of links){l=l.replace(/[)\]>,;!?\s]+$/,'').replace(/&amp;/g,'&');if(/token=|verify|login/i.test(l))return l;} }
  return null;
}
async function findWidget(cdp) {
  const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true }); let r = null;
  (function dfs(n,d){if(r||d>100||!n)return;const t=(n.localName||'').toLowerCase();if(t==='iframe'&&n.attributes){const a=Array.isArray(n.attributes)?n.attributes:[];const i=a.findIndex(x=>x==='src');const s=i>=0?(a[i+1]||''):'';if(s.includes('challenges.cloudflare')||s.includes('turnstile')){r={nodeId:n.nodeId,src:s};return;}}if(n.shadowRoots)for(const sr of n.shadowRoots)dfs(sr,d+1);if(n.children)for(const c of n.children)dfs(c,d+1);if(n.contentDocument)dfs(n.contentDocument,d+1);})(root,0);
  if(!r)return null; try{const bm=await cdp.send('DOM.getBoxModel',{nodeId:r.nodeId});if(bm?.model?.content){const c=bm.model.content;r.box={x:c[0],y:c[1],w:c[2]-c[0],h:c[5]-c[1]};}}catch(e){} return r;
}

// nginx配置脚本
const NGINX_SETUP = `
# 检查现有nginx并添加/keepalive反向代理
if ! command -v nginx &>/dev/null; then
  sudo apt update -qq && sudo apt install -y nginx
fi

# 看ZO用什么端口
ZO_PORT=$(sudo netstat -tlnp | grep ':80 ' | awk '{print $7}' | cut -d/ -f1 || echo "")
echo "ZO process: $ZO_PORT"

# 找到默认配置
if [ -f /etc/nginx/sites-enabled/default ]; then
  CFG=/etc/nginx/sites-enabled/default
elif [ -f /etc/nginx/conf.d/default.conf ]; then
  CFG=/etc/nginx/conf.d/default.conf
else
  echo "no nginx config found, creating..."
  CFG=/etc/nginx/sites-enabled/default
fi

# 备份
sudo cp $CFG ${CFG}.bak 2>/dev/null

# 写入新配置 - 加/keepalive路径代理到localhost:3000
sudo tee $CFG << 'NGINXCONF'
server {
    listen 80 default_server;
    server_name _;

    # 保活面板
    location /keepalive/ {
        proxy_pass http://127.0.0.1:3000/;
        proxy_set_header Host $host;
    }
    location /keepalive {
        return 301 /keepalive/;
    }

    # ZO桌面UI透传
    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
NGINXCONF

sudo nginx -t && sudo systemctl reload nginx && echo "NGINX_OK" || echo "NGINX_FAIL"
`;

async function main() {
  const { chromium } = await import('playwright');
  const context = await chromium.launchPersistentContext(
    join(homedir(), 'AppData', 'Local', 'zo-panel-path'),
    { headless: false, executablePath: 'C:\\Users\\XZXyuan\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe', args: [`--disable-extensions-except=${EXT_DIR}`, `--load-extension=${EXT_DIR}`, '--disable-blink-features=AutomationControlled', '--window-size=1440,900'] }
  );
  const page = context.pages()[0] || await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('DOM.enable');

  // 登录
  log('登录...');
  try { await page.goto('https://www.zo.computer/signup', { waitUntil: 'networkidle', timeout: 30000 }); } catch(e) {}
  await sleep(3000);
  await seval(page, () => { for (const btn of document.querySelectorAll('button,a')) { if (/email/i.test(btn.textContent||'') && btn.offsetParent) { btn.click(); return; } } });
  await sleep(2000);
  await seval(page, e => { const inp=document.querySelector('input[type=email]')||document.querySelector('input'); if(inp){ const s=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set; s.call(inp,e); inp.dispatchEvent(new Event('input',{bubbles:true})); } }, acc.email);
  await sleep(500);
  await seval(page, () => { for(const btn of document.querySelectorAll('button')){ if(/continue/i.test(btn.textContent||'')){ btn.click();return; } } });
  await sleep(3000);

  const st=new Date(Date.now()-5000); let link=null, rt=acc.refreshToken;
  for(let i=0;i<60;i++){try{const {at,rt:nr}=await getMsToken(acc.clientId,rt);rt=nr;link=await findLink(at,st);}catch(e){} if(link)break; await sleep(3000); process.stdout.write('.'); }
  if(!link){log('\n无link');await context.close();return;}
  try{await page.goto(link,{waitUntil:'domcontentloaded',timeout:60000});}catch(e){}
  await sleep(12000);
  for(let a=0;a<10;a++){let host='x';try{host=(()=>{try{return new URL(page.url()).hostname}catch(e){return''}})();}catch(e){} if(host.endsWith('.zo.computer')&&host!=='www.zo.computer'){log(`✅ ${host}`);break;} const w=await findWidget(cdp);if(w?.box&&w.box.w>0&&a<3){const{x,y,h:bh}=w.box;try{await page.mouse.move(x+28,y+bh/2,{steps:8});await sleep(100);await page.mouse.down();await sleep(50);await page.mouse.up();}catch(e){}} await sleep(3000);}

  log('等ZO(50s)...');
  await sleep(50000);

  // 终端
  await page.keyboard.press('Control+Backquote');
  await sleep(8000);

  async function term(cmd, desc, wait=25000){
    log(`[${desc}]`);
    for(const ch of cmd){await page.keyboard.type(ch);await sleep(15);}
    await sleep(500);await page.keyboard.press('Enter');
    log('  ✅');
    await sleep(wait);
  }

  // 先看ZO80端口上跑的是什么
  await term('sudo netstat -tlnp | head -20', '端口检查');
  await term('ps aux | grep -E "nginx|node|next" | grep -v grep | head -10', '进程检查');

  // 杀掉旧的保活和80端口占用
  await term('sudo pkill -9 -f keepalive.js 2>/dev/null; echo "killed"', '杀旧保活');

  // 下载保活脚本
  await term('curl -fsSL -o /home/user/keepalive.js https://raw.githubusercontent.com/xingluoyuankong/ZO-register/master/keepalive_full_puppet.js && echo OK', '下载脚本');

  // 在3000端口启动保活
  await term('cd /home/user && nohup xvfb-run -a node keepalive.js > /tmp/keepalive.log 2>&1 & echo "PID=$!"', '启动保活:3000');

  // 验证保活
  await term('sleep 10 && ps aux | grep -v grep | grep keepalive && echo "RUNNING"', '验证保活');
  await term('curl -s localhost:3000 | head -3', '验证面板');

  // ★ 配置nginx反向代理 /keepalive -> localhost:3000
  log('\n===== 配置nginx =====');
  // base64编码nginx配置脚本
  const nginxB64 = Buffer.from(NGINX_SETUP).toString('base64');
  await term(`echo '${nginxB64}' | base64 -d > /tmp/nginx_setup.sh && chmod +x /tmp/nginx_setup.sh`, '写nginx脚本');
  await term('sudo bash /tmp/nginx_setup.sh 2>&1', '运行nginx配置', 40000);

  // 测试外部访问
  await term('curl -s localhost/keepalive/ | head -5', '测试路径');
  await term('curl -s localhost/keepalive/api/state', '测试API');

  log('\n===== ✅ 完成 =====');
  log('ZO桌面: https://builderpcux.zo.computer');
  log('保活面板: https://builderpcux.zo.computer/keepalive/');
  log('保活API: https://builderpcux.zo.computer/keepalive/api/state');
  log('保持60s...');
  await sleep(60000);
  await context.close();
}

main().catch(e => { log(`错误: ${e.message}`); process.exit(1); });
