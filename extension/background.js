/**
 * ZO 注册助手 - Background Service Worker
 */

var state = {
  emails: [],
  running: false,
  stopRequested: false,
  concurrency: 1,
  _registerGen: 0,
  stats: { total: 0, pending: 0, success: 0, fail: 0, inProgress: 0 }
};

// ===== 自动保活状态 =====
var keepaliveState = {
  enabled: false,
  lastSent: 0,
  sentCount: 0,
  lastQuestion: ''
};
var KEEPALIVE_INTERVAL_MS = 30 * 60 * 1000; // 30分钟
var keepaliveTimerId = null;

var keepaliveQuestions = [
  '你好，今天天气怎么样？',
  '帮我解释一下什么是机器学习',
  'Python和JavaScript有什么区别？',
  '给我讲一个有趣的小故事',
  '如何提高编程效率？',
  '推荐几本好书吧',
  '什么是大语言模型？',
  '帮我写一首简短的诗',
  '人工智能的未来发展趋势是什么？',
  '如何保持学习的动力？',
  '介绍一下量子计算的基本概念',
  '有什么好的时间管理方法？',
  '解释一下区块链技术',
  '推荐一些提升思维的方法',
  '什么是API？简单解释一下',
  '如何开始学习一门新语言？',
  '云计算和本地部署有什么区别？',
  '给我一个有趣的科学冷知识',
  '什么是深度学习？',
  '如何培养创造性思维？',
  '介绍一下太空探索的最新进展',
  '怎样写出好的代码注释？',
  '什么是自然语言处理？',
  '推荐一些提高效率的工具',
  '数据结构和算法为什么重要？',
  '介绍一下人工智能的应用场景',
  '如何做好项目管理？',
  '什么是开源软件？',
  '解释一下网络安全的基本概念',
  '怎样快速定位和修复代码bug？'
];

var TOTAL_STEPS = 10;
var VERIFY_WAIT_MS = 480000;
var VERIFY_POLL_MS = 5000;

function sleep(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }

async function sleepWithStop(ms, email) {
  var step = 250;
  var waited = 0;
  while (waited < ms) {
    checkStop(email);
    await sleep(Math.min(step, ms - waited));
    waited += step;
  }
}

function checkStop(email) {
  if (state.stopRequested || (!state.running && email)) throw new Error("用户已停止");
}

function stepLog(email, idx, msg, level) {
  var progress = "[" + idx + "/" + TOTAL_STEPS + "] " + msg;
  setEmailProgress(email, progress);
  doLog(email, progress, level);
}

function broadcast(msg) {
  try { chrome.runtime.sendMessage(msg).catch(function() {}); } catch (e) {}
}

function updateStats() {
  state.stats.total = state.emails.length;
  state.stats.pending = state.emails.filter(function(e) { return e.status === "pending"; }).length;
  state.stats.success = state.emails.filter(function(e) { return e.status === "success"; }).length;
  state.stats.fail = state.emails.filter(function(e) { return e.status === "fail"; }).length;
  state.stats.registered = state.emails.filter(function(e) { return e.status === "registered"; }).length;
  state.stats.inProgress = state.emails.filter(function(e) { return e.status === "registering"; }).length;
  saveState();
  broadcast({ type: "stats", data: state.stats });
}

function setEmailStatus(email, status, extra) {
  extra = extra || {};
  var item = state.emails.find(function(e) { return e.email === email; });
  if (item) {
    item.status = status;
    Object.assign(item, extra);
    updateStats();
    broadcast({ type: "email_update", data: { email: email, status: status, handle: item.handle || "", error: item.error || "", progress: item.progress || "", url: item.url || "" } });
  }
}

function setEmailProgress(email, progress) {
  var item = state.emails.find(function(e) { return e.email === email; });
  if (item) {
    item.progress = progress;
    saveState();
    broadcast({ type: "email_update", data: { email: email, status: item.status, handle: item.handle || "", error: item.error || "", progress: item.progress || "", url: item.url || "" } });
  }
}

function doLog(email, msg, level) {
  broadcast({ type: "log", data: { email: email || "", msg: msg, level: level || "" } });
  console.log("[ZO] " + (email || "") + " " + msg);
}

function saveState() {
  try {
    chrome.storage.local.set({ zo_emails: state.emails, zo_config: { concurrency: state.concurrency } }, function() {});
  } catch (e) {}
}

// SW 启动恢复：上次 Service Worker 被杀时 registering 状态的邮箱会变成僵尸
function recoverStaleEmails() {
  var stale = state.emails.filter(function(e) { return e.status === "registering"; });
  if (stale.length > 0) {
    stale.forEach(function(e) {
      e.status = "pending";
      e.error = "上次注册中断（SW 重启）";
      e.progress = "";
    });
    updateStats();
    doLog("", "⚠ 检测到 " + stale.length + " 个邮箱上次注册中断，已自动重置为待处理");
  }
}

// ===== 自动保活功能 =====
function getRandomKeepaliveQuestion() {
  // 避免连续重复：从去掉上一个的池子里随机选
  var pool = keepaliveQuestions;
  if (keepaliveQuestions.length > 1 && keepaliveState.lastQuestion) {
    pool = keepaliveQuestions.filter(function(q) { return q !== keepaliveState.lastQuestion; });
  }
  return pool[Math.floor(Math.random() * pool.length)];
}

async function runKeepaliveOnce() {
  if (!keepaliveState.enabled) return;
  doLog('', '[保活] 开始执行...');
  try {
    // ★ 修复：不用 tabs.query 的通配符子域名（不可靠），改为查所有 zo.computer 标签页后过滤
    var allTabs = [];
    try { allTabs = allTabs.concat(await chrome.tabs.query({ url: 'https://www.zo.computer/*' })); } catch (e) {}
    try { allTabs = allTabs.concat(await chrome.tabs.query({ url: 'https://zo.computer/*' })); } catch (e2) {}
    try { allTabs = allTabs.concat(await chrome.tabs.query({ url: 'https://*.zo.computer/*' })); } catch (e3) {}
    // 去重
    var seen = {};
    allTabs = allTabs.filter(function(t) {
      if (!t || seen[t.id]) return false;
      seen[t.id] = true;
      return true;
    });
    // 筛选出 ZO 主界面的 tab（子域名，非 www/signup）
    var mainTabs = allTabs.filter(function(t) {
      try {
        var h = new URL(t.url).hostname.toLowerCase();
        return h.endsWith('.zo.computer') && h !== 'www.zo.computer' && h !== 'zo.computer';
      } catch (e) { return false; }
    });
    if (mainTabs.length === 0) {
      doLog('', '[保活] 未找到 ZO 主界面标签页（共查到 ' + allTabs.length + ' 个 zo 标签页），跳过本次', 'error');
      broadcast({ type: 'keepalive_state', data: keepaliveState });
      return;
    }
    var tab = mainTabs[0];
    doLog('', '[保活] 找到标签页: ' + tab.url);
    await ensureContentScript(tab.id);
    var question = getRandomKeepaliveQuestion();
    doLog('', '[保活] 发送问题: ' + question);
    var resp = await sendToTab(tab.id, { type: 'zo_step', step: 'keepalive_send', text: question }, 30000);
    doLog('', '[保活] 响应: ' + JSON.stringify(resp));
    if (resp && resp.ok) {
      keepaliveState.lastSent = Date.now();
      keepaliveState.sentCount++;
      keepaliveState.lastQuestion = question;
      saveKeepaliveState();
      doLog('', '[保活] ✅ 已发送: ' + question, 'success');
    } else {
      doLog('', '[保活] ❌ 发送失败: ' + (resp ? resp.error : '无响应'), 'error');
    }
  } catch (e) {
    doLog('', '[保活] 异常: ' + e.message, 'error');
  }
  broadcast({ type: 'keepalive_state', data: keepaliveState });
}

function saveKeepaliveState() {
  try {
    chrome.storage.local.set({ zo_keepalive: {
      enabled: keepaliveState.enabled,
      lastSent: keepaliveState.lastSent,
      sentCount: keepaliveState.sentCount,
      lastQuestion: keepaliveState.lastQuestion
    }}, function() {});
  } catch (e) {}
}

function startKeepaliveTimer() {
  stopKeepaliveTimer();
  // 使用 chrome.alarms（SW 休眠后仍可靠唤醒）
  try {
    // ★ 关键修复：设置 delayInMinutes=0.1（约6秒后首次触发），不能只设 periodInMinutes
    // 否则首次触发要等完整30分钟周期
    chrome.alarms.create('zo_keepalive', { delayInMinutes: 0.1, periodInMinutes: 30 });
    doLog('', '[保活] chrome.alarms 已设置，约6秒后首次触发，之后每30分钟');
  } catch (e) {
    // 回退：用 setInterval（仅在 alarms 不可用时）
    keepaliveTimerId = setInterval(runKeepaliveOnce, KEEPALIVE_INTERVAL_MS);
    doLog('', '[保活] setInterval 回退已设置');
  }
}

function stopKeepaliveTimer() {
  try { chrome.alarms.clear('zo_keepalive'); } catch (e) {}
  if (keepaliveTimerId) {
    clearInterval(keepaliveTimerId);
    keepaliveTimerId = null;
  }
}

// 消息处理
chrome.runtime.onMessage.addListener(function(msg, sender, sendResponse) {
  try {
    if (msg.type === "get_state") {
      sendResponse({ emails: state.emails, stats: state.stats, running: state.running, concurrency: state.concurrency });
      return false;
    }

    if (msg.type === "load_emails") {
      var parsed = parseEmailCredentials(msg.text || "");
      var count = 0, skipped = 0;
      for (var i = 0; i < parsed.length; i++) {
        var itemIn = parsed[i];
        var exists = state.emails.find(function(e) { return e.email.toLowerCase() === itemIn.email.toLowerCase(); });
        if (!exists) {
          state.emails.push({
            email: itemIn.email, password: itemIn.password || "",
            clientId: itemIn.clientId, refreshToken: itemIn.refreshToken,
            status: "pending", handle: "", error: "", progress: ""
          });
          count++;
        } else skipped++;
      }
      updateStats();
      sendResponse({ ok: true, count: count, skipped: skipped, parsed: parsed.length });
      return false;
    }

    if (msg.type === "start_batch") {
      if (state.running) { sendResponse({ ok: false, error: "已在运行" }); return false; }
      state.stopRequested = false;
      startBatch();
      sendResponse({ ok: true });
      return false;
    }

    if (msg.type === "stop_batch") {
      state.stopRequested = true;
      state.running = false;
      saveState();
      broadcast({ type: "batch_stop" });
      doLog("", "■ 已请求停止，当前流程会在下一次检查点中断");
      sendResponse({ ok: true });
      return false;
    }

    if (msg.type === "register_one") {
      if (state.running) { sendResponse({ ok: false, error: "当前有注册流程在运行，请先停止或等待完成" }); return false; }
      var item = state.emails.find(function(e) { return e.email === msg.email; });
      if (!item) { sendResponse({ ok: false, error: "找不到" }); return false; }
      if (item.status === "registering") {
        sendResponse({ ok: false, error: "该邮箱正在注册" }); return false;
      }
      if (item.status === "success") {
        sendResponse({ ok: false, error: "该邮箱已成功；如需重来请先删除后重新导入" }); return false;
      }
      if (item.status === "registered") {
        sendResponse({ ok: false, error: "该邮箱已注册过；如需重来请先删除后重新导入" }); return false;
      }
      item.status = "pending";
      item.error = "";
      item.progress = "";
      item.handle = "";
      item.url = "";
      updateStats();
      broadcast({ type: "single_start", data: { email: item.email } });
      doRegisterOne(item);
      sendResponse({ ok: true });
      return false;
    }

    if (msg.type === "delete_email") {
      if (state.running) { sendResponse({ ok: false, error: "注册流程运行中，不能删除邮箱" }); return false; }
      var beforeDelete = state.emails.length;
      state.emails = state.emails.filter(function(e) { return e.email !== msg.email; });
      updateStats();
      sendResponse({ ok: true, removed: beforeDelete - state.emails.length, emails: state.emails });
      return false;
    }

    if (msg.type === "clear_status") {
      if (state.running) { sendResponse({ ok: false, error: "注册流程运行中，不能批量清理" }); return false; }
      var statuses = Array.isArray(msg.statuses) ? msg.statuses : [];
      var beforeClear = state.emails.length;
      state.emails = state.emails.filter(function(e) { return statuses.indexOf(e.status) < 0; });
      updateStats();
      sendResponse({ ok: true, removed: beforeClear - state.emails.length, emails: state.emails });
      return false;
    }

    if (msg.type === "reset_failed") {
      state.emails.filter(function(e) { return e.status === "fail"; }).forEach(function(e) {
        e.status = "pending"; e.error = ""; e.progress = "";
      });
      updateStats();
      sendResponse({ ok: true });
      return false;
    }

    if (msg.type === "clear_all") {
      state.stopRequested = true;
      // 不立即清空，让 doRegisterOne 在下一个 checkStop 自然退出
      // 延迟清空以避免 doRegisterOne 持有的引用悬空
      setTimeout(function() {
        state.emails = [];
        state.running = false;
        updateStats();
      }, 2000);
      sendResponse({ ok: true });
      return false;
    }

    if (msg.type === "update_config") {
      // 当前流程强制串行，避免多个账号复用同一个 zo tab 导致状态串线
      state.concurrency = 1;
      saveState();
      sendResponse({ ok: true });
      return false;
    }

    if (msg.type === "keepalive_toggle") {
      keepaliveState.enabled = !keepaliveState.enabled;
      if (keepaliveState.enabled) {
        startKeepaliveTimer();
        // 立即发送第一条（异步执行，完成后广播状态更新）
        runKeepaliveOnce().then(function() {
          saveKeepaliveState();
          broadcast({ type: 'keepalive_state', data: keepaliveState });
        });
      } else {
        stopKeepaliveTimer();
      }
      saveKeepaliveState();
      sendResponse({ ok: true, enabled: keepaliveState.enabled, data: keepaliveState });
      return false;
    }

    if (msg.type === "keepalive_get_state") {
      sendResponse({ ok: true, data: keepaliveState });
      return false;
    }

    if (msg.type === "content_ready") {
      doLog("", "内容脚本已注入: " + msg.url);
      return false;
    }

    if (msg.type === "zo_log") {
      doLog(msg.email || "", msg.msg, msg.level);
      return false;
    }

    return false;
  } catch (e) {
    try { sendResponse({ ok: false, error: e.message }); } catch (ex) {}
    return false;
  }
});

function parseEmailCredentials(text) {
  var out = [];
  var seen = {};
  var normalized = String(text || "").replace(/\r/g, "\n").replace(/[\t ]*[-–—]{4,}[\t ]*/g, "----");
  var lines = normalized.split("\n");
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();
    if (!line || /^#|^\/\//.test(line)) continue;
    var parts = line.split("----").map(function(s) { return s.trim(); }).filter(function(s) { return s !== ""; });
    if (parts.length < 4) parts = line.split(/[|,;\t]/).map(function(s) { return s.trim(); }).filter(function(s) { return s !== ""; });
    if (parts.length >= 4 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(parts[0])) {
      var email = parts[0].toLowerCase();
      if (!seen[email]) {
        seen[email] = true;
        out.push({ email: email, password: parts[1] || "", clientId: parts[2], refreshToken: parts.slice(3).join("----") });
      }
    }
  }
  return out;
}

// Graph API
async function getMailToken(clientId, refreshToken) {
  var body = new URLSearchParams({
    client_id: clientId, grant_type: "refresh_token",
    refresh_token: refreshToken,
    scope: "https://graph.microsoft.com/.default offline_access"
  });
  var resp = await fetch("https://login.microsoftonline.com/consumers/oauth2/v2.0/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: body.toString()
  });
  var data = await resp.json();
  if (data.error) throw new Error("Token: " + data.error_description);
  return { accessToken: data.access_token, newRefreshToken: data.refresh_token || refreshToken };
}

async function findMagicLink(accessToken, afterTime) {
  var resp = await fetch("https://graph.microsoft.com/v1.0/me/messages?$top=10&$select=subject,body,from,receivedDateTime&$orderby=receivedDateTime%20desc", {
    headers: { Authorization: "Bearer " + accessToken }
  });
  var mail = await resp.json();
  if (!mail.value) return null;
  for (var i = 0; i < mail.value.length; i++) {
    var msg = mail.value[i];
    if (new Date(msg.receivedDateTime) < afterTime) continue;
    var combined = (msg.subject || "") + " " + (msg.from && msg.from.emailAddress ? msg.from.emailAddress.name + " " + msg.from.emailAddress.address : "") + " " + (msg.body ? msg.body.content : "");
    if (!/zo/i.test(combined)) continue;
    var hrefs = combined.match(/href=["']([^"']*zo\.computer[^"']*)["']/gi) || [];
    var raws = combined.match(/https?:\/\/[^\s"'<>]*zo\.computer[^\s"'<>]*/gi) || [];
    var all = hrefs.map(function(h) { return h.replace(/^href=["']/i, "").replace(/["']$/, ""); }).concat(raws);
    for (var j = 0; j < all.length; j++) {
      var link = all[j].replace(/[)\]>,;!?\s]+$/, "").replace(/&amp;/g, "&").replace(/&#38;/g, "&").replace(/&#61;/g, "=");
      if (/token=|verify|login|sign|验证|登录|注册/i.test(link)) return link;
    }
  }
  return null;
}

// 判断是否为不可恢复的风控/滥用错误（应立即标记失败，跳过该邮箱）
function isFatalMailError(msg) {
  if (!msg) return false;
  // AADSTS70000: 账号被标记为 service abuse mode
  // AADSTS50196: 服务器因请求循环终止操作
  // AADSTS50146: 应用需要满足条件访问策略
  // AADSTS700016: 应用已被禁用
  // AADSTS7000222: 账号已禁用
  // invalid_client: clientId 无效
  // invalid_grant: refreshToken 无效/过期
  // AADSTS7000024: refreshToken 已过期
  return /AADSTS70000|AADSTS50196|AADSTS50146|AADSTS700016|AADSTS7000222|AADSTS7000024|invalid_client|invalid_grant|service abuse mode|request loop|account.*disabled/i.test(msg);
}

async function pollMagicLink(clientId, refreshToken, afterTime, email) {
  var rt = refreshToken;
  var deadline = Date.now() + 180000;
  while (Date.now() < deadline) {
    checkStop(email);
    try {
      var r = await getMailToken(clientId, rt);
      rt = r.newRefreshToken;
      var link = await findMagicLink(r.accessToken, afterTime);
      if (link) return { link: link, newRefreshToken: rt };
    } catch (e) {
      doLog(email, "轮询错误: " + e.message, "error");
      // 风控/滥用错误立即终止，不浪费时间重试
      if (isFatalMailError(e.message)) {
        throw new Error("邮箱被风控: " + e.message.split(" Trace ID")[0].split(" Correlation")[0].trim());
      }
    }
    await sleepWithStop(3000, email);
  }
  return null;
}

// 标签页 / 会话隔离
async function purgeZoSession(email) {
  var origins = ["https://www.zo.computer", "https://zo.computer"];
  try {
    await chrome.browsingData.remove({ origins: origins }, {
      cookies: true,
      localStorage: true,
      indexedDB: true,
      cacheStorage: true,
      serviceWorkers: true
    });
  } catch (e) {
    doLog(email || "", "清理 ZO 会话失败，继续尝试: " + e.message, "error");
  }
  try { await chrome.browsingData.removeCache({}); } catch (e2) {}
}

async function queryZoTabs() {
  var a = [];
  try { a = a.concat(await chrome.tabs.query({ url: "https://www.zo.computer/*" })); } catch (e) {}
  try { a = a.concat(await chrome.tabs.query({ url: "https://zo.computer/*" })); } catch (e2) {}
  var seen = {};
  return a.filter(function(t) {
    if (!t || seen[t.id]) return false;
    seen[t.id] = true;
    return true;
  });
}

async function closeZoTabs() {
  var tabs = await queryZoTabs();
  for (var i = 0; i < tabs.length; i++) {
    try { await chrome.tabs.remove(tabs[i].id); } catch (e) {}
  }
}

async function openFreshSignupTab(email) {
  // 批量注册必须等价于“每个账号单独注册”：每一轮都清空目标站会话并从全新 signup 页开始。
  await purgeZoSession(email);
  await closeZoTabs();
  var tab = await chrome.tabs.create({ url: "https://www.zo.computer/signup?zo_batch_ts=" + Date.now(), active: true });
  await waitForTabLoad(tab.id, 30000);
  await ensureContentScript(tab.id);
  return tab;
}
function waitForTabLoad(tabId, timeout) {
  return new Promise(function(resolve) {
    var timer = setTimeout(function() {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }, timeout || 30000);
    function listener(tid, info) {
      if (tid === tabId && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        clearTimeout(timer);
        resolve();
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function ensureContentScript(tabId) {
  try {
    // 先 ping 看内容脚本是否已存在
    var resp = await sendToTabRaw(tabId, { type: 'ping' });
    if (resp && resp.ok) return;
  } catch (e) {}
  // 不存在则手动注入
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      files: ['content/content.js']
    });
  } catch (e) { doLog('', '注入内容脚本失败: ' + e.message, 'error'); }
}

async function sendToTab(tabId, msg, timeoutMs) {
  var timeout = timeoutMs || 10000;
  return new Promise(function(resolve) {
    var done = false;
    var timer = setTimeout(function() {
      if (!done) { done = true; resolve({ ok: false, error: 'sendToTab timeout' }); }
    }, timeout);
    try {
      chrome.tabs.sendMessage(tabId, msg, function(resp) {
        if (!done) {
          done = true;
          clearTimeout(timer);
          if (chrome.runtime.lastError) resolve({ ok: false, error: chrome.runtime.lastError.message });
          else resolve(resp || { ok: true });
        }
      });
    } catch (e) {
      if (!done) { done = true; clearTimeout(timer); resolve({ ok: false, error: e.message }); }
    }
  });
}

async function sendToTabRaw(tabId, msg) {
  return await chrome.tabs.sendMessage(tabId, msg);
}

// 注册流程
async function doRegisterOne(emailItem) {
  var email = emailItem.email;
  var singleMode = !state.running;
  var registerGen = ++state._registerGen;
  if (singleMode) { state.running = true; state.stopRequested = false; }
  try {
    checkStop(email);
    setEmailStatus(email, "registering", { error: "", progress: "" });
    stepLog(email, 1, "准备注册：清理 ZO 会话并打开全新注册页");
    var tab = await openFreshSignupTab(email);
    checkStop(email);
    await sleepWithStop(1000, email);
    stepLog(email, 2, "注入内容脚本并测试连接");
    await ensureContentScript(tab.id);
    await sleepWithStop(500, email);
    var ping = await sendToTab(tab.id, { type: 'ping' });
    if (!ping || !ping.ok) throw new Error('内容脚本未就绪');
    checkStop(email);

    stepLog(email, 3, "点击邮件注册按钮");
    var resp = await sendToTab(tab.id, { type: "zo_step", step: "click_email_btn" });
    if (!resp || !resp.ok) throw new Error("点击邮件按钮: " + (resp ? resp.error : "无响应"));
    checkStop(email);

    stepLog(email, 4, "填写邮箱并发送登录邮件");
    resp = await sendToTab(tab.id, { type: "zo_step", step: "fill_email", email: email });
    if (!resp || !resp.ok) throw new Error("填写邮箱: " + (resp ? resp.error : "无响应"));
    var sendTime = new Date(Date.now() - 3000);
    checkStop(email);

    stepLog(email, 5, "轮询收件箱，等待 magic link");
    var result = await pollMagicLink(emailItem.clientId, emailItem.refreshToken, sendTime, email);
    if (!result) throw new Error("3分钟内未收到 magic link");
    doLog(email, "收到 magic link!");
    if (result.newRefreshToken !== emailItem.refreshToken) { emailItem.refreshToken = result.newRefreshToken; saveState(); }
    checkStop(email);

    stepLog(email, 6, "打开 magic link 并等待页面跳转");
    resp = await sendToTab(tab.id, { type: "zo_step", step: "open_link", link: result.link });
    if (!resp || !resp.ok) throw new Error("打开链接: " + (resp ? resp.error : "无响应"));
    await sleepWithStop(2000, email);
    await waitForTabLoad(tab.id, 30000);
    await ensureContentScript(tab.id);
    await sleepWithStop(1000, email);
    checkStop(email);

    // ★ Step 6b: 主动处理 Cloudflare Turnstile
    stepLog(email, 6.5, "检测并处理 Cloudflare Turnstile");
    var tsHandled = false;
    for (var tsAttempt = 0; tsAttempt < 3; tsAttempt++) {
      var tsResp = await sendToTab(tab.id, { type: "zo_step", step: "turnstile_check" }, 15000);
      if (tsResp && tsResp.stage === "turnstile_solving") {
        doLog(email, "[Turnstile] 检测到 Turnstile 挑战，正在自动处理 (尝试 " + (tsAttempt + 1) + "/3)...");
        await sleepWithStop(6000, email);
        tsHandled = true;
      } else if (tsResp && tsResp.stage === "turnstile_ready") {
        doLog(email, "[Turnstile] 令牌已就绪，等待页面跳转");
        await sleepWithStop(3000, email);
        tsHandled = true;
        break;
      } else {
        // 没有 Turnstile 或已完成
        break;
      }
    }
    if (tsHandled) {
      doLog(email, "[Turnstile] 处理完成");
    }
    checkStop(email);

    stepLog(email, 7, "等待邮箱链接验证完成");
    resp = await waitForVerifyStep(tab.id, email);
    doLog(email, '[验证] waitForVerifyStep 返回: ' + JSON.stringify(resp));
    if (!resp || !resp.ok) throw new Error("验证: " + (resp ? resp.error : "无响应"));
    checkStop(email);

    stepLog(email, 8, "设置 Handle / Profile");
    resp = await sendToTab(tab.id, { type: "zo_step", step: "set_handle", email: email }, 30000);
    if (!resp || !resp.ok) throw new Error("SetHandle: " + (resp ? resp.error : "无响应"));
    var handle = resp.handle || email.split('@')[0].replace(/[^a-zA-Z0-9]/g, '').substring(0, 8);
    checkStop(email);

    stepLog(email, 9, "处理条款、Go to your Zo、手机号跳过等 Onboarding");
    resp = await waitForOnboardingFlow(tab.id, email);
    if (!resp || !resp.ok) throw new Error("Onboarding: " + (resp ? resp.error : "无响应"));

    // 已注册邮箱：直接进入主界面，跳过新注册流程
    if (resp.stage === "registered") {
      stepLog(email, 10, "邮箱已注册过，直接进入主界面", "success");
      setEmailStatus(email, "registered", { url: resp.url, progress: "[10/10] 已注册" });
      doLog(email, "ℹ️ 邮箱已注册过: " + resp.url, "success");
      doLog(email, "[统计] 新注册: " + state.emails.filter(function(e){return e.status==="success"}).length + ", 已注册: " + state.emails.filter(function(e){return e.status==="registered"}).length + ", 失败: " + state.emails.filter(function(e){return e.status==="fail"}).length + ", 剩余: " + state.emails.filter(function(e){return e.status==="pending"}).length);
      return { ok: true, registered: true };
    }

    stepLog(email, 10, "注册完成：已到达 ZO 主界面", "success");
    setEmailStatus(email, "success", { handle: handle, url: resp.url, progress: "[10/10] 注册完成" });
    doLog(email, "✅ 全部流程完成! " + resp.url, "success");
    doLog(email, "[统计] 成功: " + state.emails.filter(function(e){return e.status==="success"}).length + ", 失败: " + state.emails.filter(function(e){return e.status==="fail"}).length + ", 剩余待处理: " + state.emails.filter(function(e){return e.status==="pending"}).length);
    return { ok: true };
  } catch (e) {
    if (e.message === "用户已停止") {
      doLog(email, "已停止，保留为待处理", "error");
      setEmailStatus(email, "pending", { error: "", progress: "已停止，可重新开始" });
      return { ok: false, stopped: true };
    }
    var errorMsg = e.message || "未知错误";
    doLog(email, "❌ 失败: " + errorMsg, "error");
    setEmailStatus(email, "fail", { error: errorMsg });
    doLog(email, "[统计] 成功: " + state.emails.filter(function(e2){return e2.status==="success"}).length + ", 失败: " + state.emails.filter(function(e2){return e2.status==="fail"}).length + ", 剩余待处理: " + state.emails.filter(function(e2){return e2.status==="pending"}).length);
    return { ok: false, error: errorMsg };
  } finally {
    if (singleMode && state._registerGen === registerGen) {
      state.running = false;
      state.stopRequested = false;
      broadcast({ type: "batch_done" });
    }
  }
}

// 等待验证步骤完成：background 轮询短消息，只有真的离开 verify 或出现 handle/profile 才算完成
async function waitForVerifyStep(tabId, email) {
  doLog(email, '[验证] waitForVerifyStep 启动，tabId=' + tabId);
  var deadline = Date.now() + VERIFY_WAIT_MS;
  var tick = 0;
  var lastStage = '';
  doLog(email, '[验证] 验证码/邮箱验证最多等待 ' + Math.round(VERIFY_WAIT_MS / 60000) + ' 分钟');

  while (Date.now() < deadline) {
    checkStop(email);
    tick++;
    try { await ensureContentScript(tabId); } catch (e) {}

    var resp = await sendToTab(tabId, { type: 'zo_step', step: 'verify_tick' }, 8000);
    if (!resp || !resp.ok) {
      var err = resp ? resp.error : '无响应';
      doLog(email, '[验证] 本轮通信失败，重新注入后继续: ' + err);
      checkStop(email);
      await sleepWithStop(VERIFY_POLL_MS, email);
      continue;
    }

    if (resp.stage && (resp.stage !== lastStage || tick % 10 === 0)) {
      var extra = resp.text ? (' | ' + resp.text) : '';
      doLog(email, '[验证] ' + resp.stage + ' url=' + (resp.url || '').substring(0, 80) + extra);
      lastStage = resp.stage;
    }

    if (resp.done) return resp;
    await sleepWithStop(VERIFY_POLL_MS, email);
  }

  return { ok: false, error: '验证超时' };
}

async function waitForOnboardingFlow(tabId, email) {
  var deadline = Date.now() + 600000;
  var tick = 0;
  var lastStage = '';
  while (Date.now() < deadline) {
    checkStop(email);
    tick++;
    await sleepWithStop(3000, email);

    // 页面跳转或 BFCache 可能让 content-script 消息通道断开；每轮都先确保脚本存在
    try { await ensureContentScript(tabId); } catch (e) {}

    var resp = await sendToTab(tabId, { type: 'zo_step', step: 'onboarding_tick' }, 8000);
    if (!resp || !resp.ok) {
      var err = resp ? resp.error : '无响应';
      doLog(email, '[Onboarding] 本轮通信失败，重新注入后继续: ' + err);
      checkStop(email);
      try { await ensureContentScript(tabId); } catch (e2) {}
      continue;
    }

    if (resp.stage && (resp.stage !== lastStage || tick % 10 === 0)) {
      var extra = resp.text ? (' | ' + resp.text) : '';
      doLog(email, '[Onboarding] ' + resp.stage + ' url=' + (resp.url || '').substring(0, 80) + extra);
      lastStage = resp.stage;
    }

    if (resp.done) return resp;
  }
  return { ok: false, error: 'Onboarding 超时' };
}

async function startBatch() {
  if (state.running) return;
  state.running = true;
  state.stopRequested = false;
  broadcast({ type: "batch_start" });
  doLog("", "▶ 批量注册开始（串行）");
  var pending = state.emails.filter(function(e) { return e.status === "pending"; });
  var queue = pending.slice();
  while (queue.length > 0 && state.running && !state.stopRequested) {
    var item = queue.shift();
    if (!item || item.status !== "pending") continue;
    await doRegisterOne(item);
    if (state.running && !state.stopRequested) await sleepWithStop(2000, "");
  }
  var stopped = state.stopRequested;
  state.running = false;
  state.stopRequested = false;
  broadcast({ type: stopped ? "batch_stop" : "batch_done" });
  doLog("", stopped ? "■ 批量注册已停止" : "✅ 批量注册完成", stopped ? "" : "success");
}

// 扩展图标
chrome.action.onClicked.addListener(function(tab) {
  chrome.sidePanel.open({ tabId: tab.id }).catch(function() {});
});

chrome.sidePanel.setOptions({ path: "sidepanel/sidepanel.html", enabled: true }).catch(function() {});

console.log("[ZO] Background started");

// chrome.alarms 唤醒处理
chrome.alarms.onAlarm.addListener(function(alarm) {
  if (alarm.name === 'zo_keepalive') {
    runKeepaliveOnce();
  }
});

// SW 启动时从 storage 恢复状态，然后清理僵尸邮箱
chrome.storage.local.get({ zo_emails: [], zo_config: {}, zo_keepalive: null }, function(data) {
  if (data.zo_emails && data.zo_emails.length > 0) {
    state.emails = data.zo_emails;
    state.concurrency = 1;
    recoverStaleEmails();
    doLog("", "✅ 已从存储恢复 " + state.emails.length + " 个邮箱");
  }
  // 恢复保活状态
  if (data.zo_keepalive) {
    keepaliveState.enabled = !!data.zo_keepalive.enabled;
    keepaliveState.lastSent = data.zo_keepalive.lastSent || 0;
    keepaliveState.sentCount = data.zo_keepalive.sentCount || 0;
    keepaliveState.lastQuestion = data.zo_keepalive.lastQuestion || '';
    if (keepaliveState.enabled) {
      startKeepaliveTimer();
      doLog('', '[保活] 已从存储恢复，自动保活已开启');
    }
  }
});

