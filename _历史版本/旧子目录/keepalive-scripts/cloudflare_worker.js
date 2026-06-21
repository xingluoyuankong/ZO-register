/**
 * Cloudflare Worker — ZO保活外部监控面板
 * 部署到: https://zo-keepalive.你的用户名.workers.dev
 * 
 * ZO内部的保活脚本每5-12分钟发一次心跳POST /heartbeat
 * 访问根路径显示状态面板
 */

// 全局状态(Cloudflare Workers用KV更持久，这里用全局变量做演示)
let latestState = {
  lastAlive: null,
  cycleCount: 0,
  aiMessages: 0,
  mouseMoves: 0,
  status: 'unknown',
  currentAction: 'unknown',
  started: null
};

const PANEL_HTML = `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="refresh" content="30">
<title>ZO KeepAlive Monitor</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0a0a1a;color:#e0e0e0;font-family:-apple-system,BlinkMacSystemFont,system-ui,sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center}
.card{background:#12122a;border:1px solid #2a2a4a;border-radius:16px;padding:32px;max-width:500px;width:95%}
h1{font-size:1.4em;margin-bottom:8px}
.status-bar{display:flex;align-items:center;gap:10px;margin-bottom:24px}
.dot{width:14px;height:14px;border-radius:50%;display:inline-block}
.dot.alive{background:#7cffb3;animation:pulse 2s infinite}
.dot.dead{background:#ff6b6b}
@keyframes pulse{50%{opacity:.3}}
.badge{font-size:.8em;padding:2px 10px;border-radius:12px;font-weight:600}
.badge.alive{background:rgba(124,255,179,.15);color:#7cffb3}
.badge.dead{background:rgba(255,107,107,.15);color:#ff6b6b}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:24px}
.item{background:#1a1a3a;border-radius:10px;padding:14px}
.item .label{font-size:.75em;color:#777;margin-bottom:4px;text-transform:uppercase;letter-spacing:.5px}
.item .value{font-size:1.1em;font-family:monospace;font-weight:600}
.item .value.green{color:#7cffb3}
.item .value.blue{color:#64b5f6}
.item .value.orange{color:#ffb74d}
.item .value.purple{color:#ce93d8}
.footer{margin-top:24px;text-align:center;font-size:.75em;color:#444}
.footer a{color:#555;text-decoration:none}
.footer a:hover{color:#7cffb3}
</style>
</head>
<body>
<div class="card">
<h1>ZO KeepAlive Monitor</h1>
<div class="status-bar">
<div class="dot STATUS_CLASS"></div>
<span class="badge STATUS_CLASS">STATUS_TEXT</span>
<span style="font-size:.85em;color:#888">STATUS_ACTION</span>
</div>
<div class="grid">
<div class="item"><div class="label">Last Heartbeat</div><div class="value green">LAST_ALIVE</div></div>
<div class="item"><div class="label">Since Started</div><div class="value blue">UPTIME</div></div>
<div class="item"><div class="label">Cycles</div><div class="value purple">CYCLES</div></div>
<div class="item"><div class="label">AI Messages</div><div class="value orange">AI_MSGS</div></div>
<div class="item"><div class="label">Mouse Ops</div><div class="value blue">MOUSE</div></div>
<div class="item"><div class="label">Started At</div><div class="value purple" style="font-size:.8em">STARTED</div></div>
</div>
<div class="footer">
Auto-refresh 30s | <a href="/api/state">JSON API</a> | <span id="time">--</span>
</div>
</div>
<script>
function fmtTime(t){if(!t)return'--';const d=new Date(t),n=new Date();const s=Math.floor((n-d)/1000);if(s<60)return s+'s ago';const m=Math.floor(s/60);if(m<60)return m+'m ago';const h=Math.floor(m/60);if(h<24)return h+'h '+m%60+'m ago';return Math.floor(h/24)+'d '+h%24+'h ago'}
fetch('/api/state').then(r=>r.json()).then(s=>{
document.querySelector('.dot').className='dot '+(s.alive?'alive':'dead');
document.querySelector('.badge').className='badge '+(s.alive?'alive':'dead');
document.querySelector('.badge').textContent=s.alive?'ALIVE':'DEAD';
document.querySelector('.status-bar span:last-child').textContent=s.currentAction||'';
document.querySelector('.green').textContent=fmtTime(s.lastAlive);
document.querySelector('.blue').textContent=s.uptime||'--';
document.querySelector('.purple').textContent=s.cycleCount||0;
document.querySelector('.orange').textContent=s.aiMessages||0;
document.querySelector('.blue').textContent=s.mouseMoves||0;
document.querySelector('.purple').textContent=s.started?new Date(s.started).toLocaleString():'--';
document.getElementById('time').textContent=new Date().toLocaleTimeString();
}).catch(e=>console.error(e));
</script>
</body>
</html>`;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    
    // POST /heartbeat — ZO内部发心跳
    if (url.pathname === '/heartbeat' && request.method === 'POST') {
      try {
        const data = await request.json();
        latestState = {
          ...latestState,
          ...data,
          lastHeartbeat: new Date().toISOString()
        };
        return new Response('OK', { status: 200 });
      } catch(e) {
        return new Response('Invalid JSON', { status: 400 });
      }
    }

    // GET /api/state — JSON状态
    if (url.pathname === '/api/state') {
      const now = Date.now();
      const lastAlive = latestState.lastAlive ? new Date(latestState.lastAlive).getTime() : 0;
      const alive = (now - lastAlive) < 30 * 60 * 1000; // 30分钟内有心跳=存活
      const started = latestState.started ? new Date(latestState.started).getTime() : 0;
      const uptimeSec = started ? Math.floor((now - started) / 1000) : 0;
      const h = Math.floor(uptimeSec / 3600);
      const m = Math.floor((uptimeSec % 3600) / 60);
      
      return new Response(JSON.stringify({
        alive,
        lastAlive: latestState.lastAlive,
        lastHeartbeat: latestState.lastHeartbeat,
        cycleCount: latestState.cycleCount || 0,
        aiMessages: latestState.aiMessages || 0,
        mouseMoves: latestState.mouseMoves || 0,
        currentAction: latestState.currentAction || 'unknown',
        status: latestState.status || 'unknown',
        started: latestState.started,
        uptime: h + 'h ' + m + 'm'
      }), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    // GET / — HTML面板
    const now = Date.now();
    const lastAlive = latestState.lastAlive ? new Date(latestState.lastAlive).getTime() : 0;
    const alive = (now - lastAlive) < 30 * 60 * 1000;
    
    let html = PANEL_HTML;
    html = html.replace(/STATUS_CLASS/g, alive ? 'alive' : 'dead');
    html = html.replace(/STATUS_TEXT/g, alive ? 'ALIVE' : 'DEAD');
    html = html.replace(/STATUS_ACTION/g, latestState.currentAction || '');
    html = html.replace(/LAST_ALIVE/g, latestState.lastAlive ? formatTime(latestState.lastAlive) : '--');
    html = html.replace(/UPTIME/g, latestState.started ? formatTime(latestState.started) : '--');
    html = html.replace(/CYCLES/g, latestState.cycleCount || '0');
    html = html.replace(/AI_MSGS/g, latestState.aiMessages || '0');
    html = html.replace(/MOUSE/g, latestState.mouseMoves || '0');
    html = html.replace(/STARTED/g, latestState.started ? new Date(latestState.started).toLocaleString() : '--');

    return new Response(html, {
      headers: { 'Content-Type': 'text/html;charset=utf-8' }
    });
  }
};

function formatTime(iso) {
  const d = new Date(iso);
  const n = new Date();
  const s = Math.floor((n - d) / 1000);
  if (s < 60) return s + 's ago';
  const m = Math.floor(s / 60);
  if (m < 60) return m + 'm ago';
  const h = Math.floor(m / 60);
  if (h < 24) return h + 'h ' + (m % 60) + 'm ago';
  return Math.floor(h / 24) + 'd ' + (h % 24) + 'h ago';
}
