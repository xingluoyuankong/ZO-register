#!/usr/bin/env python3
"""ZO Computer 单邮箱注册 - 快速版"""
import subprocess, json, re, time, sys, os

EMAIL_FILE = sys.argv[1] if len(sys.argv) > 1 else "/home/workspace/extracted_emails/mx40f8e3rb1508k2xlbbi@hotmail.com.txt"

# 解析邮箱文件
with open(EMAIL_FILE, encoding="utf-8-sig") as f:
    parts = f.read().replace("\r", "").strip().split("----")
EMAIL = parts[0].strip()
CLIENT_ID = parts[2].strip()
REFRESH_TOKEN = parts[3].strip()

print(f"Email: {EMAIL}")

def agent_eval(js):
    r = subprocess.run(["agent-browser", "eval", js], capture_output=True, text=True, timeout=15)
    return r.stdout.strip().strip('"')

def agent_open(url):
    subprocess.run(["agent-browser", "open", url], capture_output=True, text=True, timeout=30)

def agent_click(ref):
    subprocess.run(["agent-browser", "click", ref], capture_output=True, text=True, timeout=10)

def agent_snapshot():
    r = subprocess.run(["agent-browser", "snapshot", "-i"], capture_output=True, text=True, timeout=10)
    return r.stdout

# Step 1: 发邮件
print("\n[1] 打开注册页并发送魔法链接...")
agent_open("https://www.zo.computer/signup")
time.sleep(2)

# 点击 "Email me a sign-up link"
agent_eval("(() => { const btns = document.querySelectorAll('button'); for (const b of btns) { if (b.textContent.includes('Email me')) { b.click(); return 'clicked'; } } return 'not found'; })()")
time.sleep(2)

# 填写邮箱（React 方式）
agent_eval(f"(() => {{ const inp = document.querySelector('input[type=email]'); if (!inp) return 'no input'; const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; setter.call(inp, '{EMAIL}'); inp.dispatchEvent(new Event('input', {{ bubbles: true }})); return inp.value; }})()")
time.sleep(1)

# 点击 Continue
agent_eval("(() => { const btns = document.querySelectorAll('button'); for (const b of btns) { if (b.textContent.trim() === 'Continue' && !b.disabled) { b.click(); return 'clicked'; } } return 'not found'; })()")
send_time = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
print(f"   发送时间: {send_time}")

# Step 2: curl 轮询收件箱
print("\n[2] 轮询收件箱获取魔法链接...")
GRAPH_TOKEN_URL = "https://login.microsoftonline.com/consumers/oauth2/v2.0/token"
GRAPH_MAIL_URL = "https://graph.microsoft.com/v1.0/me/messages"

magic_link = None
rt = REFRESH_TOKEN
for i in range(24):
    time.sleep(5)
    try:
        # 获取 access token
        r = subprocess.run(["curl", "-s", "-X", "POST", GRAPH_TOKEN_URL,
            "-H", "Content-Type: application/x-www-form-urlencoded",
            "-d", f"client_id={CLIENT_ID}&grant_type=refresh_token&refresh_token={rt}&scope=https://graph.microsoft.com/.default offline_access"],
            capture_output=True, text=True, timeout=15)
        token_data = json.loads(r.stdout)
        access_token = token_data["access_token"]
        rt = token_data.get("refresh_token", rt)
        
        # 获取邮件
        r = subprocess.run(["curl", "-s", GRAPH_MAIL_URL,
            "-G", "-d", "$top=5&$select=subject,body,receivedDateTime&$orderby=receivedDateTime desc",
            "-H", f"Authorization: Bearer {access_token}"],
            capture_output=True, text=True, timeout=15)
        mail_data = json.loads(r.stdout)
        
        for msg in (mail_data.get("value") or []):
            received = msg.get("receivedDateTime", "")
            if received < send_time:
                continue
            body = ((msg.get("body") or {}).get("content", "") or "")
            subject = msg.get("subject", "") or ""
            combined = subject + " " + body
            if "zo" not in combined.lower():
                continue
            links = re.findall(r'https://www\.zo\.computer/api/email-login/verify[^\s"\'<>]*', combined)
            for link in links:
                link = re.sub(r'[)\]>,;!?]+$', '', link).replace("&amp;", "&")
                if "token=" in link:
                    magic_link = link
                    break
            if magic_link:
                break
        if magic_link:
            break
        print(f"   轮询 {i+1}/24...", file=sys.stderr)
    except Exception as e:
        print(f"   错误: {e}", file=sys.stderr)

if not magic_link:
    print("FAIL: 未收到魔法链接")
    sys.exit(1)

print(f"   魔法链接: {magic_link[:80]}...")

# Step 3: 打开链接，等 Turnstile 通过，点 Continue
print("\n[3] 打开魔法链接...")
agent_open(magic_link)
time.sleep(3)

print("[4] 等待 Turnstile 自动完成...")
for i in range(15):
    time.sleep(3)
    text = agent_eval("document.body.innerText.substring(0, 200)")
    url = agent_eval("document.location.href")
    print(f"   [{i+1}] URL: {url[:50]} | Body: {text[:40]}...")
    
    if "choose" in text.lower() or "handle" in text.lower():
        print("   到达 Handle 选择页!")
        break
    if "Continue in browser" in text:
        # 等一下让 Turnstile 通过
        time.sleep(5)
        # 点击 Continue
        agent_click("@e33")
        time.sleep(3)
    if "invalid" in text.lower() or "expired" in text.lower():
        print("   Token 过期!")
        break

# Step 5: 选择 Handle
print("\n[5] 选择 Handle...")
snapshot = agent_snapshot()
if "Choose your handle" in snapshot or "handle" in snapshot.lower():
    HANDLE = "user" + "".join([chr(ord('a')+i%26) for i in range(6)])
    # 填写 handle
    agent_eval(f"(() => {{ const inp = document.querySelector('input'); if (inp) {{ const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; setter.call(inp, '{HANDLE}'); inp.dispatchEvent(new Event('input', {{ bubbles: true }})); return inp.value; }} return 'no input'; }})()")
    time.sleep(1)
    # 点击 Continue
    agent_eval("(() => { const btns = document.querySelectorAll('button'); for (const b of btns) { if (b.textContent.trim() === 'Continue') { b.click(); return 'clicked'; } } return 'not found'; })()")
    print(f"   Handle: {HANDLE}")
    
    # 等待 boot
    print("\n[6] 等待 Boot...")
    for i in range(30):
        time.sleep(10)
        text = agent_eval("document.body.innerText.substring(0, 100)")
        if "Go to your Zo" in text or "dashboard" in text.lower():
            print(f"   注册成功! https://{HANDLE}.zo.computer")
            break

print("\nDone!")
