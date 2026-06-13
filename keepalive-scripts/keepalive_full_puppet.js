// ZO全能保活 v3 — 外部心跳(https://zo-keepalive.xzx.workers.dev) + 丰富拟人操作
const http = require('http');
const { chromium } = require('playwright');
const fs = require('fs');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const rand = (a,b) => Math.floor(a + Math.random() * (b - a + 1));
const rf = (a,b) => a + Math.random() * (b - a);
const pick = arr => arr[Math.floor(Math.random() * arr.length)];

let state = {
  started: new Date().toISOString(),
  lastAlive: new Date().toISOString(),
  cycleCount: 0, aiMessages: 0, mouseMoves: 0, scrolls: 0,
  newSessions: 0, clicks: 0, status: 'running', currentAction: 'init'
};

// 本地面板(localhost:3000, ZO内部访问)
const PANEL_HTML = `<!DOCTYPE html><html lang="zh"><head><meta charset="UTF-8"><meta http-equiv="refresh" content="30"><title>ZO Alive</title><style>*{margin:0;padding:0;box-sizing:border-box}body{background:#0a0a1a;color:#e0e0e0;font-family:system-ui;display:flex;align-items:center;justify-content:center;min-height:100vh}.card{background:#12122a;border:1px solid#2a2a4a;border-radius:16px;padding:32px;max-width:480px;width:90%}h1{font-size:1.4em;margin-bottom:24px;color:#7cffb3}.dot{width:12px;height:12px;border-radius:50%;background:#7cffb3;animation:pulse 2s infinite;display:inline-block}@keyframes pulse{50%{opacity:.4}}.stat{margin:10px 0;display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid#1a1a3a}.stat .l{color:#888}.stat .v{font-family:monospace}.alive .v{color:#7cffb3}.danger .v{color:#ff6b6b}.ft{margin-top:24px;text-align:center;font-size:.8em;color:#555}</style></head><body><div class="card"><h1><span class="dot"></span>ZO KeepAlive</h1><div id="s">Loading...</div><div class="ft">port 3000 | heartbeat to Cloudflare Worker</div></div><script>function u(){fetch('/api/state').then(r=>r.json()).then(s=>{const a=new Date(s.lastAlive),st=new Date(s.started),n=new Date(),sec=Math.floor((n-a)/1000),min=Math.floor(sec/60),use=Math.floor((n-st)/1000),uh=Math.floor(use/3600),um=Math.floor((use%3600)/60);let ac=sec<600?'alive':(sec<900?'':'danger'),at=sec<60?'just now':min<60?min+'min ago':Math.floor(min/60)+'h '+min%60+'m ago';document.getElementById('s').innerHTML='<div class="stat '+ac+'"><span class="l">Last Alive</span><span class="v">'+at+'</span></div><div class="stat"><span class="l">Uptime</span><span class="v">'+uh+'h '+um+'m</span></div><div class="stat"><span class="l">Cycles</span><span class="v">'+s.cycleCount+'</span></div><div class="stat"><span class="l">AI Msgs</span><span class="v">'+s.aiMessages+'</span></div><div class="stat"><span class="l">Mouse</span><span class="v">'+s.mouseMoves+'</span></div><div class="stat"><span class="l">Sessions</span><span class="v">'+s.newSessions+'</span></div><div class="stat"><span class="l">Scrolls</span><span class="v">'+s.scrolls+'</span></div><div class="stat"><span class="l">Clicks</span><span class="v">'+s.clicks+'</span></div><div class="stat"><span class="l">Action</span><span class="v">'+s.currentAction+'</span></div>'})}u();setInterval(u,30000)</script></body></html>`;

// 启动本地面板(仅ZO内部可用)
http.createServer((req,res)=>{
  if(req.url==='/api/state'||req.url==='/state'){
    res.writeHead(200,{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'});
    res.end(JSON.stringify(state));
  }else{
    res.writeHead(200,{'Content-Type':'text/html;charset=utf-8'});
    res.end(PANEL_HTML);
  }
}).listen(3000,()=>console.log('[Panel] :3000'));

// 外部心跳(发送到Cloudflare Worker)
const HEARTBEAT_URL = process.env.HEARTBEAT_URL || 'https://zo-keepalive.xzx.workers.dev/heartbeat';
async function sendHeartbeat() {
  try {
    const res = await fetch(HEARTBEAT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lastAlive: state.lastAlive,
        cycleCount: state.cycleCount,
        aiMessages: state.aiMessages,
        mouseMoves: state.mouseMoves,
        status: state.status,
        currentAction: state.currentAction,
        started: state.started
      })
    });
    console.log('[Heartbeat]', res.status);
  } catch(e) {
    console.error('[Heartbeat] FAIL:', e.message);
  }
}

// 保活问题库
const Q = [
  'Explain Python vs JavaScript briefly','Write a short poem about clouds',
  'What is the best way to learn coding?','Tell me an interesting science fact',
  'How does machine learning work in simple terms?','Explain Docker simply',
  'What are TypeScript key features?','Write a bash script for disk usage check',
  'Recommend 3 must-read programming books','SQL vs NoSQL explain briefly',
  'Explain REST API in one paragraph','How do load balancers work?',
  'Create a simple HTML page with a form','Best VS Code extensions for productivity?',
  'Explain async/await with a simple example','Write an email validation regex',
  'How does Git branching work?','HTTP vs HTTPS explain',
  'Write a palindrome checker in JavaScript','What are microservices?'
];

async function cycle(){
  let b; const start=Date.now(); state.cycleCount++; state.status='running';
  try{
    b=await chromium.launch({headless:true,args:['--no-sandbox','--disable-gpu','--disable-dev-shm-usage']});
    const p=await b.newPage();
    await p.goto('https://www.zo.computer',{waitUntil:'domcontentloaded',timeout:30000});
    await sleep(rand(3000,8000));

    // 鼠标轨迹(贝塞尔曲线)
    state.currentAction='mouse';
    {
      let x=rf(100,1100),y=rf(100,650);
      for(let i=0;i<rand(5,12);i++){
        const tx=rf(100,1100),ty=rf(100,650),st=rand(3,8);
        for(let s=1;s<=st;s++){
          const p=s/st;
          await p.mouse.move(
            x+(tx-x)*p+Math.sin(p*Math.PI*1.5)*rf(-15,15),
            y+(ty-y)*p+Math.cos(p*Math.PI)*rf(-10,10)
          );
          await sleep(rand(15,40));
        }
        x=tx;y=ty;
        if(Math.random()<0.3)await sleep(rand(150,500));
      }
      state.mouseMoves+=rand(5,12);
    }

    // 滚动
    state.currentAction='scroll';
    for(let i=0;i<rand(2,5);i++){
      await p.mouse.wheel(0,rf(80,400)*(Math.random()>.3?1:-1));
      await sleep(rand(200,800));
    }
    state.scrolls+=rand(2,5);

    // AI提问(60%概率)
    if(Math.random()<0.6){
      state.currentAction='AI ask';
      const ent=await p.evaluate(()=>{
        for(const sel of['textarea','[contenteditable="true"]','[role="textbox"]']){
          const e=document.querySelector(sel);
          if(e&&e.offsetParent){e.focus();e.click();return true;}
        }
        return false;
      });
      if(ent){
        const q=pick(Q);
        for(const c of q){await p.keyboard.type(c);await sleep(rand(20,80));}
        await sleep(rand(400,1200));
        await p.keyboard.press('Enter');
        state.aiMessages++;
        await sleep(rand(20000,40000));
      }
    }

    // 新会话(25%)
    if(Math.random()<0.25){
      state.currentAction='new session';
      const ok=await p.evaluate(()=>{
        for(const e of document.querySelectorAll('button,[role="button"],a')){
          const t=(e.textContent||'').toLowerCase();
          if((t.includes('new')&&t.length<20)&&e.offsetParent){e.click();return true;}
        }
        return false;
      });
      if(ok){state.newSessions++;await sleep(rand(3000,6000));}
    }

    // 随机点击(45%)
    if(Math.random()<0.45){
      state.currentAction='click';
      await p.evaluate(()=>{
        const e=[...document.querySelectorAll('button,a,[role="button"]')].filter(x=>x.offsetParent&&(x.textContent||'').trim().length>0&&(x.textContent||'').trim().length<50);
        if(e.length){const r=e[Math.floor(Math.random()*e.length)];try{r.click()}catch(ex){}}
      });
      state.clicks++;
      await sleep(rand(800,2000));
    }

    state.lastAlive=new Date().toISOString();state.status='idle';state.currentAction='sleeping';
    const elapsed=Math.round((Date.now()-start)/1000);
    console.log(new Date().toISOString(),'KEEPALIVE_OK',elapsed+'s');
    
    // 发送心跳到外部
    sendHeartbeat();
  }catch(e){console.error(e.message)}
  finally{if(b)try{await b.close()}catch(e){}}
  
  const next = 5*60000+Math.random()*7*60000;
  setTimeout(cycle,next);
}

console.log('[KeepAlive] Full Puppet v3 started :3000, heartbeat:', HEARTBEAT_URL);
cycle();
