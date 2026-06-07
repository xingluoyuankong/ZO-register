/**
 * ZO 注册助手 - Sidepanel JavaScript
 * 所有事件通过 addEventListener 绑定（MV3 CSP 禁止 onclick）
 */
(function() {
  'use strict';

  var emails = [];
  var stats = {};
  var isRunning = false;

  function badgeHtml(s) {
    var m = { pending: '⏳ 待处理', registering: '⚡ 注册中', success: '✅ 成功', fail: '❌ 失败', registered: '🔄 已注册' };
    var cls = s === 'registering' ? 'running' : s === 'success' ? 'done' : s === 'fail' ? 'error' : s === 'registered' ? 'done' : 'idle';
    return '<span class="badge badge-' + cls + '">' + (m[s] || s) + '</span>';
  }

  function updateStats(s) {
    if (s) stats = s;
    document.getElementById('sTotal').textContent = stats.total || 0;
    document.getElementById('sPending').textContent = stats.pending || 0;
    document.getElementById('sWorking').textContent = stats.inProgress || 0;
    document.getElementById('sSuccess').textContent = stats.success || 0;
    document.getElementById('sRegistered').textContent = stats.registered || 0;
    document.getElementById('sFail').textContent = stats.fail || 0;
  }

  function escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, function(ch) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch];
    });
  }

  function addLog(email, msg, type) {
    var body = document.getElementById('logBody');
    var ts = new Date().toLocaleTimeString();
    var cls = type === 'error' ? 'err' : type === 'success' ? 'ok' : '';
    var html = '<div class="entry"><span class="ts">' + ts + '</span> <span class="em">' + (email || '') + '</span> <span class="msg ' + cls + '">' + msg + '</span></div>';
    body.innerHTML = body.innerHTML + html;
    while (body.children.length > 200) body.removeChild(body.firstChild);
  }

  function renderEmails() {
    var list = document.getElementById('emailList');
    document.getElementById('emailCount').textContent = emails.length + ' 个';
    if (!emails.length) {
      list.innerHTML = '<div style="text-align:center;padding:30px;color:#333">请先导入邮箱</div>';
      return;
    }
    var html = '';
    for (var i = 0; i < emails.length; i++) {
      var e = emails[i];
      html += '<div class="email-item">';
      html += '<span class="addr" title="' + escapeHtml(e.email) + '">' + escapeHtml(e.email) + '</span>';
      if (e.handle) html += '<span class="handle">' + escapeHtml(e.handle) + '</span>';
      html += badgeHtml(e.status);
      if (e.progress) html += '<span class="progress" title="' + escapeHtml(e.progress) + '">' + escapeHtml(e.progress.substring(0, 28)) + '</span>';
      if (e.error) html += '<span class="error" title="' + escapeHtml(e.error) + '">' + escapeHtml(e.error.substring(0, 20)) + '</span>';
      var dis = (e.status === 'registering' || e.status === 'success' || e.status === 'registered') ? ' disabled' : '';
      var delDis = (e.status === 'registering') ? ' disabled' : '';
      var lbl = e.status === 'registering' ? '...' : e.status === 'success' ? '✓' : e.status === 'fail' ? '重试' : '注册';
      html += '<button class="btn btn-secondary btn-sm reg-btn" data-email="' + escapeHtml(e.email) + '"' + dis + '>' + lbl + '</button>';
      html += '<button class="btn btn-danger btn-sm del-btn" data-email="' + escapeHtml(e.email) + '"' + delDis + '>删除</button>';
      html += '</div>';
    }
    list.innerHTML = html;
    var btns = list.querySelectorAll('.reg-btn');
    for (var j = 0; j < btns.length; j++) {
      btns[j].addEventListener('click', function(ev) {
        var email = ev.currentTarget.getAttribute('data-email');
        if (!email) return;
        ev.currentTarget.disabled = true;
        sendMsg({ type: 'register_one', email: email }, function(resp) {
          if (resp && resp.ok) {
            addLog(email, '▶ 单个注册已启动');
            loadState();
          } else {
            addLog(email, resp ? resp.error : '启动失败', 'error');
            loadState();
          }
        });
      });
    }
    var delBtns = list.querySelectorAll('.del-btn');
    for (var k = 0; k < delBtns.length; k++) {
      delBtns[k].addEventListener('click', function(ev) {
        var email = ev.currentTarget.getAttribute('data-email');
        if (!email) return;
        if (!confirm('确认删除这个邮箱？\n' + email)) return;
        sendMsg({ type: 'delete_email', email: email }, function(resp) {
          if (resp && resp.ok) {
            emails = resp.emails || [];
            renderEmails();
            addLog(email, '🗑 已删除');
          } else {
            addLog(email, resp ? resp.error : '删除失败', 'error');
          }
        });
      });
    }
  }

  function setStatus(type, text) {
    var badge = document.getElementById('statusBadge');
    badge.className = 'badge badge-' + type;
    var labels = { running: '运行中', done: '完成', error: '错误', idle: '待命' };
    badge.textContent = labels[type] || '待命';
    document.getElementById('statusText').textContent = text || '';
  }

  // ========== Safe sendMessage ==========
  function sendMsg(msg, cb) {
    try {
      chrome.runtime.sendMessage(msg, function(resp) {
        if (chrome.runtime.lastError) {
          addLog('', '❌ ' + chrome.runtime.lastError.message, 'error');
          return;
        }
        if (cb) cb(resp);
      });
    } catch (e) {
      addLog('', '❌ 发送消息失败: ' + e.message, 'error');
    }
  }

  function loadState() {
    sendMsg({ type: 'get_state' }, function(resp) {
      if (!resp) return;
      emails = resp.emails || [];
      isRunning = !!resp.running;
      updateStats(resp.stats);
      renderEmails();
      if (resp.running) {
        setStatus('running', '批量注册进行中...');
        document.getElementById('btnStart').disabled = true;
        document.getElementById('btnStop').disabled = false;
      }
      // 检测僵尸邮箱：SW 重启后 registering 但无进程
      if (!resp.running) {
        var stale = emails.filter(function(e) { return e.status === 'registering'; });
        if (stale.length > 0) {
          stale.forEach(function(e) {
            e.status = 'pending';
            e.error = '上次注册中断';
            e.progress = '';
          });
          renderEmails();
          addLog('', '⚠ 发现 ' + stale.length + ' 个中断的邮箱，已重置为待处理');
        }
      }
    });
  }


  function countCredentialLines(text) {
    return String(text || '').split(/\r?\n/).filter(function(line) {
      var t = line.trim();
      return /^[^@\s]+@[^@\s]+\.[^@\s]+/.test(t) && (t.indexOf('----') >= 0 || /[|,;\t]/.test(t));
    }).length;
  }

  function importFiles(fileList, sourceLabel) {
    var files = Array.prototype.slice.call(fileList || []).filter(function(file) {
      return /\.(txt|csv|log)$/i.test(file.name || '');
    });
    if (!files.length) {
      addLog('', '⚠ 未找到可导入的 txt/csv/log 文件', 'error');
      return;
    }
    Promise.all(files.map(function(file) {
      return new Promise(function(resolve) {
        var reader = new FileReader();
        reader.onload = function(e) {
          var text = e.target && e.target.result ? String(e.target.result) : '';
          resolve({ name: file.webkitRelativePath || file.name, text: text, count: countCredentialLines(text) });
        };
        reader.onerror = function() { resolve({ name: file.webkitRelativePath || file.name, text: '', count: 0, error: true }); };
        reader.readAsText(file);
      });
    })).then(function(results) {
      var merged = results.map(function(r) { return r.text; }).filter(Boolean).join('\n');
      var textarea = document.getElementById('emailTextarea');
      var existing = textarea.value.trim();
      textarea.value = existing ? existing + '\n' + merged : merged;
      var total = results.reduce(function(sum, r) { return sum + r.count; }, 0);
      addLog('', '📥 从' + sourceLabel + '导入: ' + results.length + ' 个文件，识别到约 ' + total + ' 条邮箱凭证');
    });
  }

  function clearByStatus(statuses, label) {
    if (!confirm('确认' + label + '？')) return;
    sendMsg({ type: 'clear_status', statuses: statuses }, function(resp) {
      if (resp && resp.ok) {
        emails = resp.emails || [];
        renderEmails();
        loadState();
        addLog('', '🧹 已' + label + '：' + (resp.removed || 0) + ' 个');
      } else {
        addLog('', '❌ 清理失败: ' + (resp ? resp.error : '未知'), 'error');
      }
    });
  }

  // ========== 绑定所有按钮事件 ==========
  function bindEvents() {
    document.getElementById('btnStart').addEventListener('click', function() {
      sendMsg({ type: 'start_batch' }, function(resp) {
        if (resp && resp.ok) {
          document.getElementById('btnStart').disabled = true;
          document.getElementById('btnStop').disabled = false;
          setStatus('running', '批量注册进行中...');
          addLog('', '▶ 批量注册已开始');
        }
      });
    });

    document.getElementById('btnStop').addEventListener('click', function() {
      sendMsg({ type: 'stop_batch' }, function() {
        document.getElementById('btnStart').disabled = false;
        document.getElementById('btnStop').disabled = true;
        setStatus('idle', '已停止');
        addLog('', '■ 已停止');
      });
    });

    document.getElementById('btnReset').addEventListener('click', function() {
      sendMsg({ type: 'reset_failed' }, function(resp) {
        if (resp && resp.ok) {
          addLog('', '↻ 已将失败项重置为待处理');
          loadState();
        } else {
          addLog('', '❌ 重置失败: ' + (resp ? resp.error : '未知'), 'error');
        }
      });
    });

    document.getElementById('btnClearSuccess').addEventListener('click', function() { clearByStatus(['success'], '清理成功邮箱'); });
    document.getElementById('btnClearRegistered').addEventListener('click', function() { clearByStatus(['registered'], '清理已注册邮箱'); });
    document.getElementById('btnClearFail').addEventListener('click', function() { clearByStatus(['fail'], '清理失败邮箱'); });
    document.getElementById('btnClearDoneFail').addEventListener('click', function() { clearByStatus(['success', 'registered', 'fail'], '清理成功+失败邮箱'); });

    document.getElementById('btnClear').addEventListener('click', function() {
      if (!confirm('确认清空所有邮箱？')) return;
      sendMsg({ type: 'clear_all' }, function() {
        emails = [];
        renderEmails();
        updateStats({ total: 0, pending: 0, success: 0, fail: 0, inProgress: 0 });
        document.getElementById('emailTextarea').value = '';
        addLog('', '🗑 已清空');
      });
    });

    document.getElementById('concurrency').addEventListener('change', function() {
      var val = parseInt(document.getElementById('concurrency').value);
      sendMsg({ type: 'update_config', config: { concurrency: val } });
    });

    document.getElementById('btnFileImport').addEventListener('click', function() {
      document.getElementById('emailFileInput').click();
    });

    document.getElementById('emailFileInput').addEventListener('change', function(event) {
      importFiles(event.target.files, '文件');
      event.target.value = '';
    });

    document.getElementById('btnFolderImport').addEventListener('click', function() {
      document.getElementById('emailFolderInput').click();
    });

    document.getElementById('emailFolderInput').addEventListener('change', function(event) {
      importFiles(event.target.files, '文件夹');
      event.target.value = '';
    });

    document.getElementById('btnPaste').addEventListener('click', function() {
      if (navigator.clipboard && navigator.clipboard.readText) {
        navigator.clipboard.readText().then(function(text) {
          if (text) {
            var textarea = document.getElementById('emailTextarea');
            var existing = textarea.value.trim();
            textarea.value = existing ? existing + '\n' + text : text;
            addLog('', '📋 从剪贴板粘贴');
          }
        }).catch(function() {
          addLog('', '⚠ 无法读取剪贴板，请手动粘贴', 'error');
        });
      } else {
        addLog('', '⚠ 浏览器不支持剪贴板API', 'error');
      }
    });

    document.getElementById('btnLoad').addEventListener('click', function() {
      var text = document.getElementById('emailTextarea').value.trim();
      if (!text) { alert('请输入邮箱列表'); return; }
      sendMsg({ type: 'load_emails', text: text }, function(resp) {
        if (resp && resp.ok) {
          addLog('', '✅ 加载了 ' + resp.count + ' 个邮箱' + (resp.skipped ? '，跳过重复 ' + resp.skipped + ' 个' : ''), 'success');
          loadState();
        } else {
          addLog('', '❌ 加载失败: ' + (resp ? resp.error : '未知'), 'error');
        }
      });
    });

    document.getElementById('btnLoadStart').addEventListener('click', function() {
      var text = document.getElementById('emailTextarea').value.trim();
      if (!text) { alert('请输入邮箱列表'); return; }
      sendMsg({ type: 'load_emails', text: text }, function(resp) {
        if (resp && resp.ok) {
          addLog('', '✅ 加载了 ' + resp.count + ' 个邮箱' + (resp.skipped ? '，跳过重复 ' + resp.skipped + ' 个' : '') + '，开始串行注册', 'success');
          loadState();
          sendMsg({ type: 'start_batch' }, function(startResp) {
            if (startResp && startResp.ok) {
              document.getElementById('btnStart').disabled = true;
              document.getElementById('btnStop').disabled = false;
              setStatus('running', '串行批量注册进行中...');
              addLog('', '▶ 串行批量注册已开始');
            } else {
              addLog('', '❌ 启动失败: ' + (startResp ? startResp.error : '未知'), 'error');
            }
          });
        } else {
          addLog('', '❌ 加载失败: ' + (resp ? resp.error : '未知'), 'error');
        }
      });
    });

    document.getElementById('btnExport').addEventListener('click', function() {
      if (!emails.length) { alert('无邮箱可导出'); return; }
      var lines = [];
      for (var i = 0; i < emails.length; i++) {
        var e = emails[i];
        lines.push(e.email + '----' + (e.password || '') + '----' + (e.clientId || '') + '----' + (e.refreshToken || ''));
      }
      var blob = new Blob([lines.join('\n')], { type: 'text/plain' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = 'zo_emails.txt'; a.click();
      URL.revokeObjectURL(url);
      addLog('', '📤 已导出 ' + emails.length + ' 个邮箱');
    });

    document.getElementById('btnClearLog').addEventListener('click', function() {
      document.getElementById('logBody').innerHTML = '';
    });

    document.getElementById('btnClearAll').addEventListener('click', function() {
      if (!emails.length) { addLog('', '📭 邮箱列表已为空'); return; }
      if (!confirm('确认清空所有 ' + emails.length + ' 个邮箱？')) return;
      sendMsg({ type: 'clear_all' }, function() {
        emails = [];
        renderEmails();
        updateStats({ total: 0, pending: 0, success: 0, fail: 0, inProgress: 0 });
        document.getElementById('emailTextarea').value = '';
        addLog('', '🗑 已清空所有邮箱');
      });
    });
  }

  // ========== 监听 background 推送 ==========
  chrome.runtime.onMessage.addListener(function(msg) {
    if (msg.type === 'stats') updateStats(msg.data);
    if (msg.type === 'email_update') {
      for (var i = 0; i < emails.length; i++) {
        if (emails[i].email === msg.data.email) {
          if (msg.data.status) emails[i].status = msg.data.status;
          if (msg.data.handle) emails[i].handle = msg.data.handle;
          if (typeof msg.data.error !== 'undefined') emails[i].error = msg.data.error;
          if (typeof msg.data.progress !== 'undefined') emails[i].progress = msg.data.progress;
          if (typeof msg.data.url !== 'undefined') emails[i].url = msg.data.url;
          break;
        }
      }
      renderEmails();
    }
    if (msg.type === 'log') addLog(msg.data.email, msg.data.msg, msg.data.level);
    if (msg.type === 'single_start') {
      isRunning = true;
      renderEmails();
      setStatus('running', '单个注册进行中...');
    }
    if (msg.type === 'batch_start') {
      isRunning = true;
      renderEmails();
      setStatus('running', '批量注册进行中...');
      document.getElementById('btnStart').disabled = true;
      document.getElementById('btnStop').disabled = false;
    }
    if (msg.type === 'batch_done') {
      isRunning = false;
      renderEmails();
      setStatus('done', '批量注册完成');
      document.getElementById('btnStart').disabled = false;
      document.getElementById('btnStop').disabled = true;
    }
    if (msg.type === 'batch_stop') {
      isRunning = false;
      renderEmails();
      setStatus('idle', '已停止');
      document.getElementById('btnStart').disabled = false;
      document.getElementById('btnStop').disabled = true;
    }
  });

  // ========== 初始化 ==========
  bindEvents();
  loadState();
  addLog('', '插件已加载');
})();
