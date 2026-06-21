#!/bin/bash
# ZO一键部署保活脚本
set -e
echo "=== ZO KeepAlive Setup ==="

# 1. 清理
sudo pkill -9 -f keepalive.js 2>/dev/null || true
sleep 2

# 2. 安装依赖（如果缺）
echo "[1/6] 安装依赖..."
sudo apt update -qq 2>/dev/null
sudo apt install -y xvfb chromium-browser nodejs npm 2>/dev/null

# 3. 安装playwright
echo "[2/6] 安装playwright..."
which playwright 2>/dev/null || npm install -g playwright 2>/dev/null
npx playwright install chromium 2>/dev/null

# 4. 下载保活脚本
echo "[3/6] 下载保活脚本..."
curl -fsSL -o /home/user/keepalive.js \
  https://raw.githubusercontent.com/xingluoyuankong/ZO-register/master/keepalive_full_puppet.js
echo "  Downloaded: $(wc -c < /home/user/keepalive.js) bytes"

# 5. 启动保活(3000端口)
echo "[4/6] 启动保活..."
cd /home/user
nohup xvfb-run -a node keepalive.js > /tmp/keepalive.log 2>&1 &
PID=$!
echo "  PID: $PID"

# 6. 等10秒验证
echo "[5/6] 验证启动..."
sleep 10
if ps -p $PID > /dev/null 2>&1; then
    echo "  RUNNING (PID: $PID)"
else
    echo "  NOT RUNNING - check /tmp/keepalive.log"
    cat /tmp/keepalive.log 2>/dev/null | tail -5
fi

# 7. 测试面板
echo "[6/6] 测试面板..."
sleep 5
curl -s -o /dev/null -w "  Panel HTTP: %{http_code}\n" localhost:3000/ || echo "  Panel not ready"
curl -s localhost:3000/api/state 2>/dev/null | head -5 || echo "  API not ready"

echo ""
echo "=== SETUP DONE ==="
echo "ZO终端查看: curl localhost:3000"
echo "ZO终端API:  curl localhost:3000/api/state"
echo "心跳日志:   cat /tmp/keepalive.log"
echo ""
echo "保活策略: 每5-12分钟随机周期"
echo "  AI提问(60%) 新会话(25%) 鼠标(80%) 滚动(70%) 点击(45%)"
