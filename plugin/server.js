/**
 * ZO Computer Batch Register - Plugin Server
 * Express + WebSocket, modular architecture
 */
const express = require("express");
const http = require("http");
const { WebSocketServer } = require("ws");
const { readFileSync, writeFileSync, appendFileSync, readdirSync, existsSync, mkdirSync } = require("fs");
const { join } = require("path");
const { registerOne } = require("./zo_register");

// ========== Config ==========
const WEB_PORT = 3456;
const CONFIG_FILE = join(__dirname, "config.json");
const REGISTERED_DIR = join(__dirname, "registered");
const RESULTS_FILE = join(REGISTERED_DIR, "results.jsonl");

let config = {
  emailDir: "C:\\Users\\XZXyuan\\Downloads\\批量注册邮箱\\已经使用",
  browserType: "edge",
  concurrency: 1,
};

// Load saved config
try {
  if (existsSync(CONFIG_FILE)) {
    const saved = JSON.parse(readFileSync(CONFIG_FILE, "utf-8"));
    Object.assign(config, saved);
  }
} catch (e) {}

function saveConfig() {
  try { writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), "utf-8"); } catch (e) {}
}

if (!existsSync(REGISTERED_DIR)) mkdirSync(REGISTERED_DIR, { recursive: true });

// ========== State ==========
const state = {
  emails: [],
  running: false,
  concurrency: config.concurrency || 1,
  stats: { total: 0, pending: 0, success: 0, fail: 0, inProgress: 0 },
  workers: [],
};
const wsClients = new Set();

// ========== Utils ==========
function broadcast(type, data) {
  const msg = JSON.stringify({ type, data, time: new Date().toISOString() });
  for (const ws of wsClients) { try { ws.send(msg); } catch (e) {} }
}

function updateStats() {
  state.stats.total = state.emails.length;
  state.stats.pending = state.emails.filter(e => e.status === "pending").length;
  state.stats.success = state.emails.filter(e => e.status === "success").length;
  state.stats.fail = state.emails.filter(e => e.status === "fail").length;
  state.stats.inProgress = state.emails.filter(e => e.status === "registering").length;
  broadcast("stats", state.stats);
}

function setEmailStatus(email, status, extra = {}) {
  const item = state.emails.find(e => e.email === email);
  if (item) {
    item.status = status;
    Object.assign(item, extra);
    updateStats();
    broadcast("email_update", { email, status, ...extra });
  }
}

function loadEmails() {
  const dir = config.emailDir;
  if (!existsSync(dir)) { state.emails = []; updateStats(); return; }
  const files = readdirSync(dir).filter(f =>
    f.endsWith(".txt") && !f.startsWith("tokens_") && !f.startsWith("merged_") && !f.startsWith("probe") && !f.startsWith("combo")
  );
  state.emails = files.map(f => {
    const content = readFileSync(join(dir, f), "utf-8").trim();
    const parts = content.split("----").map(s => s.trim());
    return {
      email: parts[0] || "", password: parts[1] || "",
      clientId: parts[2] || "", refreshToken: parts[3] || "",
      file: f, status: "pending", handle: "", error: "", progress: "",
    };
  }).filter(e => e.email && e.clientId && e.refreshToken);
  updateStats();
}

// ========== Single Register ==========
async function registerSingle(emailItem) {
  const log = (msg) => {
    broadcast("log", { email: emailItem.email, msg });
    console.log("[" + emailItem.email.substring(0, 20) + "] " + msg);
  };

  try {
    const result = await registerOne(emailItem, {
      ...config,
      registeredDir: REGISTERED_DIR,
    }, log);
    setEmailStatus(emailItem.email, "success", result);
    appendFileSync(RESULTS_FILE, JSON.stringify({ ...emailItem, ...result, time: new Date().toISOString() }) + "\n");
  } catch (e) {
    setEmailStatus(emailItem.email, "fail", { error: e.message });
    appendFileSync(RESULTS_FILE, JSON.stringify({ email: emailItem.email, status: "fail", error: e.message, time: new Date().toISOString() }) + "\n");
  }
}

// ========== Batch Runner ==========
async function runBatch() {
  if (state.running) return;
  state.running = true;
  broadcast("batch_start", { concurrency: state.concurrency });

  const pending = state.emails.filter(e => e.status === "pending");
  if (pending.length === 0) { state.running = false; broadcast("batch_done", state.stats); return; }

  const queue = [...pending];

  async function runNext() {
    if (queue.length === 0 || !state.running) return;
    const emailItem = queue.shift();
    if (!emailItem || emailItem.status !== "pending") return;
    emailItem.status = "registering"; updateStats();

    const workerId = "W" + Date.now().toString(36);
    state.workers.push({ id: workerId, email: emailItem.email, status: "active" });
    broadcast("worker_update", state.workers);

    await registerSingle(emailItem);

    state.workers = state.workers.filter(w => w.id !== workerId);
    broadcast("worker_update", state.workers);
    if (state.running) await runNext();
  }

  const workers = [];
  for (let i = 0; i < Math.min(state.concurrency, queue.length); i++) workers.push(runNext());
  await Promise.all(workers);

  state.running = false;
  broadcast("batch_done", state.stats);
}

// ========== Express + WebSocket ==========
const app = express();
app.use(express.static(join(__dirname, "public")));
app.use(express.json());

// --- Email List ---
app.get("/api/emails", (req, res) => {
  loadEmails();
  res.json({ emails: state.emails, stats: state.stats });
});

// --- Batch Control ---
app.post("/api/start", (req, res) => {
  if (state.running) return res.json({ ok: false, error: "already running" });
  runBatch();
  res.json({ ok: true });
});
app.post("/api/stop", (req, res) => {
  state.running = false;
  broadcast("batch_stop", {});
  res.json({ ok: true });
});
app.get("/api/status", (req, res) => {
  res.json({ running: state.running, stats: state.stats, workers: state.workers, concurrency: state.concurrency });
});

// --- Single Register ---
app.post("/api/register-one", (req, res) => {
  const targetEmail = req.body && req.body.email;
  if (!targetEmail) return res.json({ ok: false, error: "未指定邮箱" });
  const item = state.emails.find(e => e.email === targetEmail);
  if (!item) return res.json({ ok: false, error: "找不到邮箱" });
  if (item.status === "registering" || item.status === "success") return res.json({ ok: false, error: "已在注册或已成功" });
  item.status = "pending"; updateStats();
  registerSingle(item); // async, don't await
  res.json({ ok: true });
});

// --- Concurrency ---
app.post("/api/concurrency", (req, res) => {
  state.concurrency = Math.max(1, Math.min(10, (req.body && req.body.concurrency) || 3));
  config.concurrency = state.concurrency;
  saveConfig();
  res.json({ ok: true, concurrency: state.concurrency });
});

// --- Email Dir ---
app.get("/api/email-dir", (req, res) => {
  res.json({ dir: config.emailDir, exists: existsSync(config.emailDir) });
});
app.post("/api/email-dir", (req, res) => {
  const newDir = req.body && req.body.dir;
  if (!newDir || typeof newDir !== "string") return res.json({ ok: false, error: "请提供路径" });
  const trimmed = newDir.trim();
  if (!existsSync(trimmed)) return res.json({ ok: false, error: "路径不存在" });
  config.emailDir = trimmed;
  saveConfig();
  loadEmails();
  broadcast("emails_loaded", { emails: state.emails, stats: state.stats, dir: config.emailDir });
  res.json({ ok: true, dir: config.emailDir, count: state.emails.length });
});

// --- Browser Type ---
app.get("/api/browser-type", (req, res) => {
  res.json({ browserType: config.browserType });
});
app.post("/api/browser-type", (req, res) => {
  const bt = req.body && req.body.browserType;
  if (bt !== "chrome" && bt !== "edge") return res.json({ ok: false, error: "仅支持 chrome/edge" });
  config.browserType = bt;
  saveConfig();
  res.json({ ok: true, browserType: bt });
});

// --- Registered ---
app.get("/api/registered", (req, res) => {
  const files = existsSync(REGISTERED_DIR) ? readdirSync(REGISTERED_DIR).filter(f => f.endsWith(".txt")) : [];
  const results = [];
  if (existsSync(RESULTS_FILE)) {
    readFileSync(RESULTS_FILE, "utf-8").trim().split("\n").filter(Boolean).forEach(line => {
      try { results.push(JSON.parse(line)); } catch (e) {}
    });
  }
  res.json({ files, results });
});

// --- WebSocket ---
const server = http.createServer(app);
const wss = new WebSocketServer({ server });
wss.on("connection", (ws) => {
  wsClients.add(ws);
  ws.on("close", () => wsClients.delete(ws));
  ws.on("error", () => wsClients.delete(ws));
  ws.send(JSON.stringify({
    type: "init",
    data: {
      stats: state.stats, workers: state.workers,
      running: state.running, concurrency: state.concurrency,
      emailDir: config.emailDir, browserType: config.browserType,
    },
  }));
});

// --- Start ---
function killPortAndStart() {
  const { execSync } = require("child_process");
  try {
    const out = execSync(`netstat -ano | findstr ":${WEB_PORT}" | findstr "LISTENING"`, { encoding: "utf-8" });
    const match = out.match(/\s(\d+)\s*$/);
    if (match) { execSync(`taskkill /PID ${match[1]} /F`, { stdio: "ignore" }); }
  } catch (e) {}
  server.listen(WEB_PORT, () => {
    console.log("");
    console.log("  ZO Batch Register - Plugin");
    console.log("  Frontend: http://localhost:" + WEB_PORT);
    console.log("  Browser:  " + config.browserType);
    console.log("  Email:    " + config.emailDir);
    console.log("");
  });
}

loadEmails();
killPortAndStart();

process.on("uncaughtException", (err) => { console.error("[ERROR]", err.message); });
process.on("unhandledRejection", (err) => { console.error("[ERROR]", err); });
