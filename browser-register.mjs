/**
 * ZO 浏览器注册脚本
 * 
 * 读取 register.mjs 生成的魔法链接，用浏览器打开完成注册
 * 
 * 用法：node browser-register.mjs [--count N] [--headed]
 */

import { readFileSync, existsSync } from "fs";
import { join } from "path";

const CONFIG = {
  LOG_DIR: "E:\\API获取工具\\ZO注册\\logs",
  XB_CLI: "E:\\QClaw\\v0.2.23.532\\resources\\openclaw\\config\\skills\\xbrowser\\scripts\\xb.cjs",
  BROWSER: "cft",
  RESULTS_FILE: null, // auto-detect
};

function log(msg) {
  var ts = new Date().toISOString().replace("T", " ").replace("Z", "");
  console.log("[" + ts + "] " + msg);
}

function sleep(ms) {
  return new Promise(function(r) { setTimeout(r, ms); });
}

function getResultsFile() {
  if (CONFIG.RESULTS_FILE) return CONFIG.RESULTS_FILE;
  var today = new Date().toISOString().slice(0, 10);
  return join(CONFIG.LOG_DIR, "results_" + today + ".jsonl");
}

function loadMagicLinks() {
  var resultsFile = getResultsFile();
  if (!existsSync(resultsFile)) {
    log("No results file found: " + resultsFile);
    return [];
  }
  
  var lines = readFileSync(resultsFile, "utf-8").trim().split("\n");
  var links = [];
  for (var i = 0; i < lines.length; i++) {
    try {
      var r = JSON.parse(lines[i]);
      if (r.status === "link_found" && r.magicLink) {
        links.push({ email: r.email, link: r.magicLink });
      }
    } catch (e) {}
  }
  return links;
}

async function runXb(args) {
  var fullArgs = [CONFIG.XB_CLI].concat(args);
  
  return new Promise(function(resolve, reject) {
    var proc = spawn("node", fullArgs, { stdio: ["pipe", "pipe", "pipe"] });
    var stdout = "";
    var stderr = "";
    
    proc.stdout.on("data", function(data) { stdout += data.toString(); });
    proc.stderr.on("data", function(data) { stderr += data.toString(); });
    
    proc.on("close", function(code) {
      try {
        var result = JSON.parse(stdout);
        resolve(result);
      } catch (e) {
        resolve({ ok: false, error: "Invalid JSON: " + stdout.substring(0, 200) });
      }
    });
    
    proc.on("error", function(err) {
      reject(err);
    });
  });
}

// 使用 child_process 的 spawn
import { spawn } from "child_process";

async function openLinkInBrowser(link, email) {
  log("Opening link for: " + email);
  log("Link: " + link.substring(0, 100) + "...");
  
  // 使用 xb CLI 打开链接
  var result = await runXb(["run", "--browser", CONFIG.BROWSER, "open", link]);
  
  if (result.ok) {
    log("[OK] Page opened");
    
    // 等待页面加载
    await sleep(5000);
    
    // 截图
    var screenshot = await runXb(["run", "--browser", CONFIG.BROWSER, "screenshot"]);
    if (screenshot.ok) {
      log("[OK] Screenshot taken");
    }
    
    // 获取快照
    var snapshot = await runXb(["run", "--browser", CONFIG.BROWSER, "snapshot", "-i"]);
    if (snapshot.ok) {
      log("[OK] Snapshot taken");
      log("Page title: " + (snapshot.data && snapshot.data.title || "N/A"));
    }
    
    return { ok: true };
  } else {
    log("[FAIL] Failed to open: " + (result.error || "unknown"));
    return { ok: false, error: result.error };
  }
}

async function main() {
  var args = process.argv.slice(2);
  var countIdx = args.indexOf("--count");
  var maxCount = countIdx >= 0 ? parseInt(args[countIdx + 1]) : Infinity;
  var headed = args.includes("--headed");
  
  log("=== ZO Browser Registration ===");
  
  var links = loadMagicLinks();
  log("Found " + links.length + " magic links");
  
  if (links.length === 0) {
    log("No magic links to process. Run register.mjs first.");
    return;
  }
  
  var toProcess = links.slice(0, maxCount);
  log("Processing: " + toProcess.length + " links");
  
  var successCount = 0;
  var failCount = 0;
  
  for (var i = 0; i < toProcess.length; i++) {
    var item = toProcess[i];
    log("");
    log("[" + (i + 1) + "/" + toProcess.length + "] " + item.email);
    
    try {
      var result = await openLinkInBrowser(item.link, item.email);
      if (result.ok) {
        successCount++;
      } else {
        failCount++;
      }
    } catch (err) {
      log("[FAIL] Error: " + err.message);
      failCount++;
    }
    
    // Wait between accounts
    if (i < toProcess.length - 1) {
      await sleep(3000);
    }
  }
  
  log("");
  log("=== DONE ===");
  log("Success: " + successCount + " | Failed: " + failCount);
}

main().catch(function(err) {
  console.error("Fatal error:", err);
  process.exit(1);
});
