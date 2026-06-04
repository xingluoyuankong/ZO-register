import requests, time, re, sys

fpath = "/home/workspace/extracted_emails/tokens_bushuozaijian2026@outlook.com_combo.txt"
with open(fpath) as f:
    text = f.read().replace('\r', '').strip()
# The format is messy, split by ---- and filter empties
parts = [p.strip() for p in text.split('----') if p.strip()]
if len(parts) < 4:
    print(f"ERROR: Only {len(parts)} parts: {parts}")
    sys.exit(1)
email = parts[0]
password = parts[1]
cid = parts[2]
rtoken = parts[3].split('\n')[0].strip()
print(f"Email: {email}")
print(f"ClientID: {cid[:15]}...")
print(f"Token: {rtoken[:20]}...")
print("Polling...")

send_time = time.time() - 60  # the email was already sent
for i in range(36):
    time.sleep(5)
    try:
        br = requests.post(
            "https://login.microsoftonline.com/consumers/oauth2/v2.0/token",
            data={
                "client_id": cid,
                "grant_type": "refresh_token",
                "refresh_token": rtoken,
                "scope": "https://graph.microsoft.com/.default offline_access"
            }
        )
        td = br.json()
        if "error" in td:
            if i == 0: print(f"Token error: {td}")
            continue
        at = td["access_token"]
        mr = requests.get(
            "https://graph.microsoft.com/v1.0/me/messages?$top=5&$select=subject,body,receivedDateTime&$orderby=receivedDateTime desc",
            headers={"Authorization": f"Bearer {at}"}
        )
        msgs = mr.json().get("value", [])
        for msg in msgs:
            if not msg.get("receivedDateTime"): continue
            rt = msg["receivedDateTime"]
            try:
                rtime = time.mktime(time.strptime(rt[:19], "%Y-%m-%dT%H:%M:%S"))
                rtime += (int(rt[20:23]) if len(rt) > 20 else 0) / 1000
            except:
                continue
            if rtime < send_time - 30: continue
            body_html = (msg.get("body") or {}).get("content", "")
            if not body_html: continue
            m = re.search(r'https://www\.zo\.computer/api/email-login/verify[^\s"\'<>]*', body_html)
            if m:
                link = m.group(0).replace("&amp;", "&")
                print(f"MAGIC_LINK:{link}")
                print(f"Subject: {msg.get('subject', '')}")
                with open("/tmp/current_magic_link.txt", "w") as lf:
                    lf.write(link)
                sys.exit(0)
        print(".", end="", flush=True)
    except Exception as e:
        print(f"E:{e}", end="", flush=True)
print("\nFAILED: Magic link not found")
sys.exit(1)
