import requests, time, re, sys, os

email_file = sys.argv[1] if len(sys.argv) > 1 else "/home/workspace/extracted_emails/mxoz14sjj48hsrqs4j6c@outlook.com.txt"
with open(email_file) as f:
    parts = f.read().strip().split("----")
    email, password, client_id, refresh_token = parts[0], parts[1], parts[2], parts[3]

print(f"Email: {email}")

token_url = "https://login.microsoftonline.com/consumers/oauth2/v2.0/token"
graph_url = "https://graph.microsoft.com/v1.0/me/messages"

for attempt in range(60):
    try:
        resp = requests.post(token_url, data={
            "client_id": client_id,
            "grant_type": "refresh_token",
            "refresh_token": refresh_token,
            "scope": "https://graph.microsoft.com/.default offline_access",
        })
        tk = resp.json()
        access = tk["access_token"]

        resp2 = requests.get(f"{graph_url}?$top=5&$select=id,subject,body,receivedDateTime&$orderby=receivedDateTime desc",
                             headers={"Authorization": f"Bearer {access}"})
        messages = resp2.json().get("value", [])

        for msg in messages:
            body = msg.get("body", {})
            content = (msg.get("subject", "") + " " + (body.get("content", "")))
            if "zo" in content.lower() or "computer" in content.lower():
                links = re.findall(r'https://www\.zo\.computer/api/email-login/verify[^\s"\'<>\]\)\&]+(?:&(?:amp;)?token=[^\s"\'<>\]\)]+)?', content)
                for link in links:
                    link = link.replace("&amp;", "&")
                    print(f"MAGIC_LINK:{link}")
                    sys.exit(0)
    except Exception as e:
        pass
    time.sleep(5)
    sys.stderr.write(".")

print("FAILED")
sys.exit(1)
