/**
 * 深度探查：拦截Turnstile的所有回调和内部状态
 * 找出Cloudflare到底因为什么拒绝
 */
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOG_DIR = join(__dirname, 'logs', 'inspect');
if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));
const now = () => new Date().toISOString();
const log = msg => { const m = `[${now()}] ${msg}`; console.log(m); appendFileSync(join(LOG_DIR, 'log.txt'), m + '\n'); };

const EMAIL_FILE = 'C:\\Users\\XZXyuan\\Downloads\\批量注册邮箱\\已经使用\\sanchezquinncu3w1kkhtuc74@outlook.com.txt';
const emailContent = readFileSync(EMAIL_FILE, 'utf-8').trim();
const [EMAIL, PASSWORD, CLIENT_ID, REFRESH_TOKEN] = emailContent.split('----').map(s=>s.trim());

// ★ 关键是：在turnstile加载前注入代理，拦截render调用和所有回调
const INSPECTOR_PATCH = `
;(function() {
  if (window.__TURNSTILE_INSPECTOR__) return;
  window.__TURNSTILE_INSPECTOR__ = true;

  // 收集所有日志到全局变量
  window.__TS_LOGS = [];

  function tsLog(msg) {
    const entry = { time: Date.now(), msg: String(msg) };
    window.__TS_LOGS.push(entry);
    console.log('[TS-INSPECT]', msg);
  }

  // 拦截 turnstile 对象创建
  let origDefine = Object.defineProperty;
  let turnstileProxyInterval = setInterval(() => {
    if (typeof turnstile !== 'undefined' && turnstile.render) {
      clearInterval(turnstileProxyInterval);
      
      // 保存原始方法
      const origRender = turnstile.render.bind(turnstile);
      const origReset = turnstile.reset.bind(turnstile);
      const origGetResponse = turnstile.getResponse.bind(turnstile);
      const origRemove = turnstile.remove.bind(turnstile);
      
      // 代理 render
      turnstile.render = function(container, options) {
        tsLog('turnstile.render() called');
        tsLog('  container: ' + container);
        tsLog('  options keys: ' + Object.keys(options || {}).join(','));
        if (options) {
          tsLog('  sitekey: ' + options.sitekey);
          tsLog('  action: ' + options.action);
          tsLog('  cData: ' + options.cData);
          tsLog('  theme: ' + options.theme);
          tsLog('  size: ' + options.size);
          tsLog('  retry: ' + options.retry);
          tsLog('  refresh-expired: ' + options['refresh-expired']);
          tsLog('  appearance: ' + options.appearance);
          tsLog('  execution: ' + options.execution);
        }
        
        // 包装所有回调来捕获信息
        if (options.callback) {
          const origCb = options.callback;
          options.callback = function(token) {
            tsLog('✅ TURNSTILE CALLBACK FIRED! token=' + token.substring(0, 30) + '...');
            window.__TS_TOKEN = token;
            window.__TS_SUCCESS = true;
            origCb(token);
          };
        }
        
        if (options['error-callback']) {
          const origErr = options['error-callback'];
          options['error-callback'] = function(errorCode) {
            tsLog('❌ TURNSTILE ERROR: ' + errorCode);
            window.__TS_ERROR = errorCode;
            window.__TS_ERROR_TIME = Date.now();
            origErr(errorCode);
          };
        } else {
          // 添加 error-callback（如果没有的话）
          options['error-callback'] = function(errorCode) {
            tsLog('❌ TURNSTILE ERROR (added): ' + errorCode);
            window.__TS_ERROR = errorCode;
            window.__TS_ERROR_TIME = Date.now();
          };
        }
        
        if (options['expired-callback']) {
          const origExp = options['expired-callback'];
          options['expired-callback'] = function() {
            tsLog('⏰ TURNSTILE EXPIRED');
            window.__TS_EXPIRED = true;
            origExp();
          };
        }
        
        if (options['timeout-callback']) {
          const origTimeout = options['timeout-callback'];
          options['timeout-callback'] = function() {
            tsLog('⏱️ TURNSTILE TIMEOUT');
            window.__TS_TIMEOUT = true;
            origTimeout();
          };
        }
        
        if (options['before-interactive-callback']) {
          const origBi = options['before-interactive-callback'];
          options['before-interactive-callback'] = function() {
            tsLog('🔄 TURNSTILE BEFORE-INTERACTIVE');
            origBi();
          };
        }
        
        const id = origRender(container, options);
        tsLog('  widgetId: ' + id);
        window.__TS_WIDGET_ID = id;
        return id;
      };
      
      // 代理 reset
      turnstile.reset = function(widgetId) {
        tsLog('turnstile.reset(' + (widgetId||'') + ')');
        window.__TS_TOKEN = null;
        window.__TS_SUCCESS = false;
        window.__TS_ERROR = null;
        return origReset(widgetId);
      };
      
      // 代理 getResponse
      turnstile.getResponse = function(widgetId) {
        const token = origGetResponse(widgetId);
        if (token) {
          tsLog('turnstile.getResponse() => YES');
          window.__TS_TOKEN = token;
        }
        return token;
      };
      
      // 代理 remove
      turnstile.remove = function(widgetId) {
        tsLog('turnstile.remove(' + (widgetId||'') + ')');
        return origRemove(widgetId);
      };
      
      tsLog('🎯 Turnstile proxy installed');
    }
  }, 50);
  
  // 30秒后停止尝试
  setTimeout(() => {
    clearInterval(turnstileProxyInterval);
    if (typeof turnstile === 'undefined') {
      tsLog('⚠️ turnstile never loaded!');
    }
  }, 30000);
  
  // 基础反检测
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
})();
`;

const { chromium } = await import('playwright');

// 获取magic link（简化版）
async function getLink(){
  const browser = await chromium.launch({ headless: false, args:['--window-size=1440,900'] });
  const ctx = await browser.newContext({ viewport:{width:1440,height:900}, userAgent:'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/137.0.0.0 Safari/537.36', locale:'zh-CN' });
  const p = await ctx.newPage();
  try{await p.goto('https://www.zo.computer/signup',{waitUntil:'networkidle',timeout:30000});}catch(e){}
  await sleep(3000);
  await p.evaluate(()=>{ for(const btn of document.querySelectorAll('button,a')){ if(/email/i.test(btn.textContent||'')&&btn.offsetParent){ btn.click(); return; } } });
  await sleep(2000);
  await p.evaluate(email=>{ const inp=document.querySelector('input[type=email]')||document.querySelector('input'); if(inp){ const s=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set; s.call(inp,email); inp.dispatchEvent(new Event('input',{bubbles:true})); } }, EMAIL);
  await sleep(500);
  await p.evaluate(()=>{ for(const btn of document.querySelectorAll('button')){ if(/continue/i.test(btn.textContent||'')){ btn.click(); return; } } });
  await sleep(3000);
  const st=new Date(Date.now()-3000); let link=null, rt=REFRESH_TOKEN;
  for(let i=0;i<30;i++){try{const body=new URLSearchParams({client_id:CLIENT_ID,grant_type:'refresh_token',refresh_token:rt,scope:'https://graph.microsoft.com/.default offline_access'}); const tr=await fetch('https://login.microsoftonline.com/consumers/oauth2/v2.0/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:body.toString()}); const td=await tr.json(); if(td.error){await sleep(3000);continue;} rt=td.refresh_token||rt; const mr=await fetch('https://graph.microsoft.com/v1.0/me/messages?$top=10&$select=subject,body,receivedDateTime&$orderby=receivedDateTime%20desc',{headers:{Authorization:'Bearer '+td.access_token}}); const md=await mr.json(); for(const msg of (md.value||[])){ if(new Date(msg.receivedDateTime)<st)continue; const c=(msg.subject||'')+' '+(msg.body?.content||''); if(!/zo/i.test(c))continue; const links=c.match(/https?:\/\/[^\s"'<>]*zo\.computer[^\s"'<>]*/gi)||[]; for(let l of links){l=l.replace(/[)\]>,;!?\s]+$/,'').replace(/&amp;/g,'&'); if(/token=|verify|login/i.test(l)){link=l;break;}} if(link)break; }}catch(e){} if(link)break; process.stdout.write('.'); await sleep(3000);}
  await p.close();await ctx.close();await browser.close();
  if(!link)throw new Error('No link'); if(rt!==REFRESH_TOKEN)writeFileSync(EMAIL_FILE,[EMAIL,PASSWORD,CLIENT_ID,rt].join('----'),'utf-8');
  return link;
}

async function main() {
  log('获取magic link...');
  const magicLink = await getLink();
  log('✅ link');

  const browser = await chromium.launch({ headless: false, args:['--window-size=1440,900'] });
  const context = await browser.newContext({
    viewport:{width:1440,height:900},
    userAgent:'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/137.0.0.0 Safari/537.36',
    locale:'zh-CN',
  });

  // ★ 注入inspector
  await context.addInitScript({ content: INSPECTOR_PATCH });
  const page = await context.newPage();

  log('导航到 magic link...');
  try{await page.goto(magicLink,{waitUntil:'domcontentloaded',timeout:60000});}catch(e){}
  await sleep(3000);
  await page.screenshot({path:join(LOG_DIR,'01_initial.png')});

  // 每2秒dump turnstile状态
  for(let i=0;i<60;i++){
    const status = await page.evaluate(()=>{
      return {
        turnstileExists: typeof turnstile !== 'undefined',
        token: window.__TS_TOKEN || null,
        error: window.__TS_ERROR || null,
        errorTime: window.__TS_ERROR_TIME || null,
        success: window.__TS_SUCCESS || false,
        expired: window.__TS_EXPIRED || false,
        timeout: window.__TS_TIMEOUT || false,
        widgetId: window.__TS_WIDGET_ID || null,
        logs: window.__TS_LOGS?.slice(-20) || [],
        cfResponse: (()=>{ const inp=document.querySelector('[name="cf-turnstile-response"]'); return inp?inp.value?.substring(0,30):null; })(),
        bodyText: (document.body?.innerText||'').substring(0,200),
        url: location.href.substring(0,80),
        iframes: [...document.querySelectorAll('iframe')].map(f=>({src:(f.src||'').substring(0,80),rect:{w:f.getBoundingClientRect().width,h:f.getBoundingClientRect().height}})),
      };
    });

    log(`\n[${i*2}s] token=${status.token?'YES':'NO'} error=${status.error||'none'} success=${status.success} widgetId=${status.widgetId}`);
    log(`  cf-response: ${status.cfResponse||'empty'}`);
    log(`  body: ${status.bodyText.substring(0,100)}`);
    log(`  url: ${status.url}`);
    log(`  iframes: ${status.iframes.length}`);

    // 打印turnstile日志
    if(status.logs.length > 0){
      log(`  TS Logs (last 5):`);
      status.logs.slice(-5).forEach(l => log(`    [${new Date(l.time).toISOString()}] ${l.msg}`));
    }

    // 检查是否成功
    if(status.token){ log('\n🎉 TOKEN!'); break; }
    if(status.error){ log(`\n❌ ERROR: ${status.error}`); }

    const hostname = (()=>{try{return new URL(status.url||'').hostname}catch(e){return''}})();
    if(hostname.endsWith('.zo.computer')&&hostname!=='www.zo.computer'){log('🎉 子域名！');break;}

    await sleep(2000);
  }

  await page.screenshot({path:join(LOG_DIR,'02_final.png')});
  log('\n保持30s...');
  await sleep(30000);
  await browser.close();
  log('完成');
}

main().catch(e=>{log(`错误: ${e.message}\n${e.stack}`);process.exit(1);});
