#!/usr/bin/env python3
"""Poll an Outlook inbox for a Zo Computer magic link email."""
import sys, re, requests, time

GRAPH_TOKEN_URL = "https://login.microsoftonline.com/consumers/oauth2/v2.0/token"
GRAPH_MAIL_URL = "https://graph.microsoft.com/v1.0/me/messages"

email_file = sys.argv[1]
with open(email_file) as f:
    content = f.read().replace('\r', '').strip()
parts = [p.strip() for p in content.split('----')]
email, password, cid, rt = parts[0], parts[1], parts[2], parts[3]

send_time = time.time()
max_polls = 30
poll_interval = 6

for i in range(max_polls):
    time.sleep(poll_interval)
    try:
        t = requests.post(GRAPH_TOKEN_URL, data={
            'client_id': cid, 'grant_type': 'refresh_token',
            'refresh_token': rt, 'scope': 'https://graph.microsoft.com/.default offline_access'
        }, timeout=10).json()
        if not t.get('access_token'):
            print(f"Poll {i+1}: token error", file=sys.stderr)
            continue

        m = requests.get(
            GRAPH_MAIL_URL + '?$top=10&$select=subject,body,receivedDateTime&$orderby=receivedDateTime%20desc',
            headers={'Authorization': f'Bearer {t["access_token"]}'}, timeout=10
        ).json()

        for msg in (m.get('value') or []):
            h = (msg.get('body') or {}).get('content', '') or ''
            links = re.findall(r'https://www\.zo\.computer/api/email-login/verify[^\s"\'<>\]]+', h)
            for link in links:
                link = link.replace('&amp;', '&').rstrip(')')
                if 'token=' in link:
                    print(link)
                    sys.exit(0)
        print(f"Poll {i+1}/{max_polls}: no link yet...", file=sys.stderr)
    except Exception as e:
        print(f"Poll {i+1}: error: {e}", file=sys.stderr)

print("TIMEOUT: No magic link found", file=sys.stderr)
sys.exit(1)
