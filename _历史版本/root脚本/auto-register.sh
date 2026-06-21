#!/bin/bash
# ZO Auto Register - single email full flow
set -e

EMAIL_FILE="$1"
if [ -z "$EMAIL_FILE" ]; then
  echo "Usage: $0 <email_file_path>"
  exit 1
fi

EMAIL_NAME=$(basename "$EMAIL_FILE" .txt)
echo "=== Registering: $EMAIL_NAME ==="

# Phase 1: Poll inbox for magic link (background)
MAGIC_LINK=$(python3 -c "
import requests, time, re, sys

with open('$EMAIL_FILE') as f:
    content = f.read().replace('\r','').strip()
lines = [l for l in content.split('\n') if l.strip()]
parts = ' '.join(lines).split('----')
email = parts[0].strip()
password = parts[1].strip()
cid = parts[2].strip()
rt = parts[3].strip()

# Already sent? Poll inbox
print(f'Email: {email}', file=sys.stderr)
start = time.time()
for i in range(36):
    time.sleep(5)
    try:
        t = requests.post('https://login.microsoftonline.com/consumers/oauth2/v2.0/token', data={
            'client_id': cid, 'grant_type': 'refresh_token',
            'refresh_token': rt, 'scope': 'https://graph.microsoft.com/.default offline_access'
        }, timeout=10).json()
        if not t.get('access_token'): continue
        m = requests.get('https://graph.microsoft.com/v1.0/me/messages?\$top=5&\$select=subject,body,receivedDateTime&\$orderby=receivedDateTime desc',
            headers={'Authorization': f'Bearer {t[\"access_token\"]}'}, timeout=10).json()
        for msg in (m.get('value') or []):
            received = msg.get('receivedDateTime', '')
            h = (msg.get('body') or {}).get('content', '') or ''
            links = re.findall(r'https://www\.zo\.computer/api/email-login/verify[^\s\"\'<>\]]+', h)
            for link in links:
                link = link.replace('&amp;', '&')
                if 'token=' in link:
                    # Check it's recent
                    dt = time.time() - 120  # last 2 minutes
                    print(f'MAGIC:{link}')
                    sys.exit(0)
        print('.', end='', flush=True, file=sys.stderr)
    except Exception as e:
        print(f'!{e}', file=sys.stderr)
print('FAIL', file=sys.stderr)
sys.exit(1)
" 2>/tmp/zo-poll.log)

LINK=$(echo "$MAGIC_LINK" | grep '^MAGIC:' | sed 's/^MAGIC://')
if [ -z "$LINK" ]; then
  echo "ERROR: No magic link found. Log:"
  cat /tmp/zo-poll.log
  exit 1
fi

echo "Got magic link: ${LINK:0:80}..."

# Phase 2: Registration via agent-browser
# Open magic link
agent-browser open "$LINK"
sleep 5

# Click Turnstile if present
echo "Clicking Turnstile..."
agent-browser snapshot -i 2>&1 | grep -q "Verify you are human" && agent-browser click @e40
sleep 15

# Check state
STATE=$(agent-browser snapshot -i 2>&1)

# Keep clicking Continue in browser / waiting for redirect
for i in $(seq 1 20); do
  STATE=$(agent-browser snapshot -i 2>&1)
  if echo "$STATE" | grep -qi "choose your handle"; then
    echo "Reached handle page!"
    break
  fi
  if echo "$STATE" | grep -qi "continue in browser"; then
    REF=$(echo "$STATE" | grep "Continue in browser" | grep -oP 'ref=\K[^]]+' | head -1)
    agent-browser click @$REF 2>/dev/null
    sleep 3
    continue
  fi
  sleep 3
done

# Fill handle
HANDLE="user$(cat /dev/urandom | tr -dc 'a-z0-9' | head -c6)"
echo "Handle: $HANDLE"
agent-browser fill "input[placeholder='you']" "$HANDLE"
sleep 2

# Click Continue
REF=$(agent-browser snapshot -i 2>&1 | grep "Continue" | head -1 | grep -oP 'ref=\K[^]]+' | head -1)
agent-browser click @$REF 2>/dev/null || agent-browser press Enter
sleep 10

# Wait for boot
echo "Waiting for boot..."
for i in $(seq 1 60); do
  STATE=$(agent-browser snapshot -i 2>&1)
  if echo "$STATE" | grep -qi "go to your zo"; then
    echo "Boot complete!"
    REF=$(echo "$STATE" | grep -i "go to your zo" | grep -oP 'ref=\K[^]]+' | head -1)
    agent-browser click @$REF 2>/dev/null
    sleep 5
    echo "SUCCESS: $HANDLE"
    mkdir -p /home/workspace/ZO-register/registered
    echo "{\"email\":\"$EMAIL_NAME\",\"handle\":\"$HANDLE\",\"url\":\"https://$HANDLE.zo.computer\",\"time\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"status\":\"success\"}" >> /home/workspace/ZO-register/registered/results.jsonl
    exit 0
  fi
  if [ $((i % 6)) -eq 0 ]; then
    PCT=$(echo "$STATE" | grep -oP '\d+\.?\d*%' | head -1)
    echo "  Boot: $PCT (${i}0s)"
  fi
  sleep 10
done

echo "FAIL: Boot timeout"
echo "{\"email\":\"$EMAIL_NAME\",\"handle\":\"$HANDLE\",\"status\":\"boot_timeout\",\"time\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}" >> /home/workspace/ZO-register/registered/results.jsonl
