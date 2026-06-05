#!/bin/bash
# ZO Computer Linux 注册脚本
# 使用 agent-browser + Graph API
# 用法: bash linux-register.sh <email_file>

set -e

EMAIL_FILE="$1"
if [ -z "$EMAIL_FILE" ]; then
  echo "用法: bash linux-register.sh <email_file>"
  exit 1
fi

EMAIL_NAME=$(basename "$EMAIL_FILE" .txt)
echo "=== 注册: $EMAIL_NAME ==="

# 解析凭证
CONTENT=$(cat "$EMAIL_FILE" | tr -d '\r' | tr -d '\n')
EMAIL=$(echo "$CONTENT" | awk -F'----' '{print $1}')
PASSWORD=$(echo "$CONTENT" | awk -F'----' '{print $2}')
CLIENT_ID=$(echo "$CONTENT" | awk -F'----' '{print $3}')
REFRESH_TOKEN=$(echo "$CONTENT" | awk -F'----' '{print $4}')

echo "  Email: $EMAIL"
echo "  ClientId: ${CLIENT_ID:0:8}..."

# ===== Step 1: 打开注册页 =====
echo "[1/7] 打开注册页..."
agent-browser open "https://www.zo.computer/signup" 2>&1
sleep 3

# ===== Step 2: 点击 "Email me a sign-up link" =====
echo "[2/7] 点击 Email me a sign-up link..."
SNAPSHOT=$(agent-browser snapshot -i 2>&1)
EMAIL_REF=$(echo "$SNAPSHOT" | grep "Email me a sign-up link" | grep -oP 'ref=\K[^]]+' | head -1)
if [ -z "$EMAIL_REF" ]; then
  echo "ERROR: 找不到 'Email me a sign-up link' 按钮"
  exit 1
fi
agent-browser click "$EMAIL_REF" 2>&1
sleep 2

# ===== Step 3: 填写邮箱 =====
echo "[3/7] 填写邮箱: $EMAIL"
# 找到 email input
SNAPSHOT=$(agent-browser snapshot -i 2>&1)
EMAIL_INPUT=$(echo "$SNAPSHOT" | grep -i "email" | grep "textbox\|input" | grep -oP 'ref=\K[^]]+' | head -1)
if [ -z "$EMAIL_INPUT" ]; then
  # 尝试其他方式找 input
  EMAIL_INPUT=$(echo "$SNAPSHOT" | grep "input\|textbox" | grep -oP 'ref=\K[^]]+' | head -1)
fi
if [ -z "$EMAIL_INPUT" ]; then
  echo "ERROR: 找不到 email 输入框"
  exit 1
fi
agent-browser fill "$EMAIL_INPUT" "$EMAIL" 2>&1
sleep 1

# ===== Step 4: 点击 Continue =====
echo "[4/7] 点击 Continue..."
SNAPSHOT=$(agent-browser snapshot -i 2>&1)
CONTINUE_REF=$(echo "$SNAPSHOT" | grep -E "^- button \"Continue\"" | grep -oP 'ref=\K[^]]+' | head -1)
if [ -z "$CONTINUE_REF" ]; then
  CONTINUE_REF=$(echo "$SNAPSHOT" | grep "Continue" | grep -oP 'ref=\K[^]]+' | head -1)
fi
if [ -z "$CONTINUE_REF" ]; then
  echo "ERROR: 找不到 Continue 按钮"
  exit 1
fi
agent-browser click "$CONTINUE_REF" 2>&1
sleep 4

# 确认邮件已发送
SNAPSHOT=$(agent-browser snapshot -i 2>&1)
if echo "$SNAPSHOT" | grep -qi "check your email\|login link\|we sent"; then
  echo "  [OK] 邮件已发送"
else
  echo "  [WARN] 页面状态: $(echo "$SNAPSHOT" | head -5)"
fi
SEND_TIME=$(date +%s)

# ===== Step 5: 轮询收件箱获取魔法链接 =====
echo "[5/7] 轮询收件箱..."
MAGIC_LINK=""
CURRENT_REFRESH_TOKEN="$REFRESH_TOKEN"

for i in $(seq 1 36); do
  sleep 5
  RESULT=$(python3 -c "
import requests, re, sys, time

cid = '$CLIENT_ID'
rt = '$CURRENT_REFRESH_TOKEN'

try:
    t = requests.post('https://login.microsoftonline.com/consumers/oauth2/v2.0/token', data={
        'client_id': cid, 'grant_type': 'refresh_token',
        'refresh_token': rt, 'scope': 'https://graph.microsoft.com/.default offline_access'
    }, timeout=10).json()
    if not t.get('access_token'):
        print('NO_TOKEN', file=sys.stderr)
        sys.exit(0)
    
    new_rt = t.get('refresh_token', rt)
    if new_rt != rt:
        print(f'NEW_TOKEN:{new_rt}', file=sys.stderr)
    
    m = requests.get(
        'https://graph.microsoft.com/v1.0/me/messages?\$top=10&\$select=subject,body,receivedDateTime&\$orderby=receivedDateTime%20desc',
        headers={'Authorization': f'Bearer {t[\"access_token\"]}'}, timeout=10
    ).json()
    
    for msg in (m.get('value') or []):
        body = msg.get('body') or {}
        content = body.get('content', '') or ''
        subject = msg.get('subject', '') or ''
        combined = subject + ' ' + content
        
        if 'zo computer' in combined.lower() or 'zo.computer' in combined.lower():
            links = re.findall(r'https://www\.zo\.computer/api/email-login/verify[^\s\"\'<>\]]+', content)
            for link in links:
                link = link.replace('&amp;', '&')
                if 'token=' in link:
                    print(f'MAGIC:{link}')
                    sys.exit(0)
except Exception as e:
    print(f'ERR:{e}', file=sys.stderr)
" 2>/dev/null)
  
  # 检查是否拿到新 token
  NEW_TOKEN=$(echo "$RESULT" | grep '^NEW_TOKEN:' | sed 's/^NEW_TOKEN://')
  if [ -n "$NEW_TOKEN" ]; then
    CURRENT_REFRESH_TOKEN="$NEW_TOKEN"
    echo "  [OK] Token 已刷新"
  fi
  
  # 检查是否拿到魔法链接
  MAGIC_LINK=$(echo "$RESULT" | grep '^MAGIC:' | sed 's/^MAGIC://')
  if [ -n "$MAGIC_LINK" ]; then
    echo "  [OK] 获得魔法链接!"
    break
  fi
  
  printf "  ."
done

if [ -z "$MAGIC_LINK" ]; then
  echo ""
  echo "ERROR: 3分钟内未收到魔法链接"
  exit 1
fi

# 保存刷新后的 token
if [ "$CURRENT_REFRESH_TOKEN" != "$REFRESH_TOKEN" ]; then
  echo "${EMAIL}----${PASSWORD}----${CLIENT_ID}----${CURRENT_REFRESH_TOKEN}" > "$EMAIL_FILE"
  echo "  [OK] Token 已保存"
fi

# ===== Step 6: 打开魔法链接 =====
echo "[6/7] 打开魔法链接..."
agent-browser open "$MAGIC_LINK" 2>&1
sleep 5

# 等待 Turnstile / 重定向到 handle 页面
echo "  等待 Turnstile 验证..."
for i in $(seq 1 30); do
  SNAPSHOT=$(agent-browser snapshot -i 2>&1)
  
  if echo "$SNAPSHOT" | grep -qi "choose your handle"; then
    echo "  [OK] 到达 handle 页面!"
    break
  fi
  
  if echo "$SNAPSHOT" | grep -qi "continue in browser"; then
    CONT_REF=$(echo "$SNAPSHOT" | grep "Continue in browser" | grep -oP 'ref=\K[^]]+' | head -1)
    if [ -n "$CONT_REF" ]; then
      echo "  点击 'Continue in browser'..."
      agent-browser click "$CONT_REF" 2>&1
      sleep 5
    fi
    continue
  fi
  
  if echo "$SNAPSHOT" | grep -qi "invalid\|expired" && ! echo "$SNAPSHOT" | grep -qi "redirecting\|verif"; then
    echo "ERROR: 魔法链接已过期"
    exit 1
  fi
  
  if [ $((i % 5)) -eq 0 ]; then
    echo "  仍在等待... [$((i*3))s]"
  fi
  sleep 3
done

# 确认到达 handle 页面
SNAPSHOT=$(agent-browser snapshot -i 2>&1)
if ! echo "$SNAPSHOT" | grep -qi "choose your handle"; then
  echo "ERROR: 未能到达 handle 页面"
  echo "$SNAPSHOT" | head -10
  exit 1
fi

# ===== Step 7: 选择 handle → Continue → Boot =====
echo "[7/7] 设置 handle..."
HANDLE="user$(cat /dev/urandom | tr -dc 'a-z0-9' | head -c 6)"
echo "  Handle: $HANDLE"

# 找到 handle 输入框
SNAPSHOT=$(agent-browser snapshot -i 2>&1)
HANDLE_INPUT=$(echo "$SNAPSHOT" | grep -i "handle\|placeholder.*you\|textbox" | grep -oP 'ref=\K[^]]+' | head -1)
if [ -z "$HANDLE_INPUT" ]; then
  echo "ERROR: 找不到 handle 输入框"
  echo "$SNAPSHOT" | head -10
  exit 1
fi
agent-browser fill "$HANDLE_INPUT" "$HANDLE" 2>&1
sleep 1

# 点击 Continue
SNAPSHOT=$(agent-browser snapshot -i 2>&1)
CONTINUE_REF=$(echo "$SNAPSHOT" | grep -E "^- button \"Continue\"" | grep -oP 'ref=\K[^]]+' | head -1)
if [ -z "$CONTINUE_REF" ]; then
  CONTINUE_REF=$(echo "$SNAPSHOT" | grep "Continue" | grep -oP 'ref=\K[^]]+' | head -1)
fi
if [ -n "$CONTINUE_REF" ]; then
  agent-browser click "$CONTINUE_REF" 2>&1
  echo "  点击 Continue"
fi
sleep 5

# 等待 boot 完成
echo "  等待 computer boot..."
for i in $(seq 1 60); do
  sleep 5
  SNAPSHOT=$(agent-browser snapshot -i 2>&1)
  
  if echo "$SNAPSHOT" | grep -qi "go to your zo"; then
    echo "  [OK] Boot 完成! 点击 'Go to your Zo'..."
    GO_REF=$(echo "$SNAPSHOT" | grep -i "go to your zo" | grep -oP 'ref=\K[^]]+' | head -1)
    if [ -n "$GO_REF" ]; then
      agent-browser click "$GO_REF" 2>&1
      sleep 8
    fi
    
    # 获取最终 URL
    FINAL_URL=$(agent-browser get url 2>/dev/null || echo "https://${HANDLE}.zo.computer")
    echo "🎉 注册成功!"
    echo "  Email: $EMAIL"
    echo "  Handle: $HANDLE"
    echo "  URL: https://${HANDLE}.zo.computer"
    
    # 保存结果
    mkdir -p /home/workspace/ZO-register/registered
    echo "{\"email\":\"$EMAIL\",\"handle\":\"$HANDLE\",\"url\":\"https://${HANDLE}.zo.computer\",\"time\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"status\":\"success\"}" >> /home/workspace/ZO-register/registered/results.jsonl
    
    # 移动已注册邮箱
    mv "$EMAIL_FILE" /home/workspace/ZO-register/registered/ 2>/dev/null || true
    exit 0
  fi
  
  # 检查进度
  PCT=$(echo "$SNAPSHOT" | grep -oP '\d+\.?\d*%' | head -1)
  if [ -n "$PCT" ] && [ $((i % 6)) -eq 0 ]; then
    echo "  Boot: $PCT (${i}0s)"
  elif [ $((i % 6)) -eq 0 ]; then
    echo "  等待中... (${i}0s)"
  fi
  
  # 检查错误
  if echo "$SNAPSHOT" | grep -qi "something went wrong\|error" && ! echo "$SNAPSHOT" | grep -qi "booting\|starting\|%"; then
    echo "ERROR: Boot 失败"
    echo "$SNAPSHOT" | head -5
    exit 1
  fi
done

echo "ERROR: Boot 超时"
echo "{\"email\":\"$EMAIL\",\"handle\":\"$HANDLE\",\"status\":\"boot_timeout\",\"time\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}" >> /home/workspace/ZO-register/registered/results.jsonl
exit 1
