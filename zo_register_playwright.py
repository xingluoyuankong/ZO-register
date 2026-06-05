#!/usr/bin/env python3
"""
ZO Computer 注册 - Playwright Stealth (低内存版)
用法: python3 zo_register_playwright.py <email_file>
"""
import os, sys, json, re, time, random, string
from datetime import datetime, timezone
from pathlib import Path
from playwright.sync_api import sync_playwright
from playwright_stealth import Stealth

# ====== 配置 ======
EMAIL_DIR = "/home/workspace/extracted_emails"
REGISTERED_DIR = "/home/workspace/ZO-register/registered"
RESULTS_FILE = os.path.join(REGISTERED_DIR, "results.jsonl")
SCREENSHOT_DIR = os.path.join(REGISTERED_DIR, "screenshots")
LOG_FILE = os.path.join(REGISTERED_DIR, "register.log")
GRAPH_TOKEN_URL = "https://login.microsoftonline.com/consumers/oauth2/v2.0/token"
GRAPH_MAIL_URL = "https://graph.microsoft.com/v1.0/me/messages"

os.makedirs(SCREENSHOT_DIR, exist_ok=True)
os.makedirs(REGISTERED_DIR, exist_ok=True)

def log(msg):
    ts = datetime.now().strftime("%H:%M:%S")
    line = f"[{ts}] {msg}"
    print(line, flush=True)
    with open(LOG_FILE, "a") as f:
        f.write(line + "\n")

def parse_email_file(path):
    with open(path, "r", encoding="utf-8-sig") as f:
        content = f.read().replace("\r", "").strip()
    parts = content.split("----")
    return [p.strip() for p in parts]

def get_graph_token(client_id, refresh_token):
    import requests
    r = requests.post(GRAPH_TOKEN_URL, data={
        'client_id': client_id, 'grant_type': 'refresh_token',
        'refresh_token': refresh_token, 'scope': 'https://graph.microsoft.com/.default'
    }, timeout=15)
    return r.json()['access_token']

def poll_magic_link(client_id, refresh_token, after_time, max_wait=180):
    import requests
    deadline = time.time() + max_wait
    while time.time() < deadline:
        try:
            token = get_graph_token(client_id, refresh_token)
            m = requests.get(GRAPH_MAIL_URL,
                params={'$top': 3, '$select': 'subject,body,receivedDateTime', '$orderby': 'receivedDateTime desc'},
                headers={'Authorization': f'Bearer {token}'}, timeout=15).json()
            for msg in (m.get('value') or []):
                received = msg.get('receivedDateTime', '')
                if received < after_time:
                    continue
                body = ((msg.get('body') or {}).get('content', '') or '')
                subject = msg.get('subject', '') or ''
                combined = subject + ' ' + body
                if 'zo' not in combined.lower():
                    continue
                links = re.findall(r'https://www\.zo\.computer/api/email-login/verify[^\s"\'<>\]]+', combined)
                for link in links:
                    link = re.sub(r'[)\\]>;,!?]+$', '', link).replace('&amp;', '&')
                    if 'token=' in link:
                        return link
        except Exception as e:
            log(f"Poll error: {e}")
        time.sleep(5)
    return None

def random_handle():
    return "user" + "".join(random.choices(string.ascii_lowercase + string.digits, k=6))

def screenshot(page, name):
    path = os.path.join(SCREENSHOT_DIR, f"{name}.png")
    page.screenshot(path=path, full_page=False)
    log(f"Screenshot: {path}")

def register_one(email_file):
    email_file = str(email_file)
    email_name = Path(email_file).stem.replace("tokens_", "").replace("_combo", "")
    log(f"{'='*50}")
    log(f"Registering: {email_name}")

    # Check if already registered
    if os.path.exists(RESULTS_FILE):
        with open(RESULTS_FILE) as f:
            for line in f:
                if email_name in line and '"success"' in line:
                    log(f"SKIP: already done")
                    return "skip"

    email, password, client_id, refresh_token = parse_email_file(email_file)
    handle = random_handle()
    log(f"Handle: {handle}")

    pw = None
    browser = None
    try:
        pw = sync_playwright().start()
        browser = pw.chromium.launch(
            headless=True,
            args=['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu',
                  '--disable-extensions', '--disable-infobars', '--disable-dev-shm-usage',
                  '--disable-software-rasterizer', '--disable-background-networking']
        )
        ctx = browser.new_context(
            viewport={'width': 1280, 'height': 720},
            user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
        )
        page = ctx.new_page()
        Stealth().apply_stealth_sync(page)

        # Step 1: Open signup
        log("[1] Opening signup...")
        page.goto("https://www.zo.computer/signup", wait_until="domcontentloaded", timeout=30000)
        time.sleep(2)

        # Step 2: Click "Email me a sign-up link"
        log("[2] Clicking email link button...")
        page.evaluate("""() => {
            for (const btn of document.querySelectorAll('button')) {
                if (btn.textContent.trim() === 'Email me a sign-up link') { btn.click(); return 'ok'; }
            }
            return 'not found';
        }""")
        time.sleep(2)

        # Step 3: Fill email + Continue
        log("[3] Filling email...")
        page.evaluate("""(email) => {
            const inp = document.querySelector('input[type="email"], input[id="email"], input[placeholder*="example"]');
            if (!inp) return 'no input';
            const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
            setter.call(inp, email);
            inp.dispatchEvent(new Event('input', { bubbles: true }));
            return 'ok: ' + inp.value;
        }""", email)
        time.sleep(1)
        page.evaluate("""() => {
            for (const btn of document.querySelectorAll('button')) {
                if (btn.textContent.trim() === 'Continue' && !btn.disabled) { btn.click(); return 'ok'; }
            }
            return 'not found';
        }""")
        send_time = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        log(f"[OK] Email sent at {send_time}")
        time.sleep(2)

        # Step 4: Poll for magic link
        log("[4] Polling inbox...")
        magic_link = poll_magic_link(client_id, refresh_token, send_time)
        if not magic_link:
            log(f"[FAIL] No magic link for {email_name}")
            screenshot(page, f"{email_name}_FAIL_no_link")
            return "no_link"
        log(f"[OK] Got link: {magic_link[:60]}...")

        # Step 5: Open magic link
        log("[5] Opening magic link...")
        page.goto(magic_link, wait_until="domcontentloaded", timeout=30000)
        time.sleep(5)
        screenshot(page, f"{email_name}_step5")

        # Step 6: Wait for Turnstile + handle page
        log("[6] Waiting for Turnstile...")
        for i in range(24):
            time.sleep(3)
            url = page.url
            body = page.evaluate("() => document.body.innerText.substring(0, 200)")
            log(f"  [{i+1}] {url[:60]} | {body[:60]}")

            if 'choose' in body.lower() or 'handle' in body.lower():
                log("[OK] Handle page!")
                break
            if 'continue in browser' in body.lower():
                page.evaluate("""() => {
                    for (const el of document.querySelectorAll('*')) {
                        if (el.textContent.trim() === 'Continue in browser' && el.children.length === 0) { el.click(); return 'ok'; }
                    }
                }""")
                time.sleep(5)
            if 'invalid' in body.lower() or 'expired' in body.lower():
                log("[FAIL] Token expired!")
                screenshot(page, f"{email_name}_FAIL_expired")
                return "expired"
            if 'dashboard' in url or '/home' in url or 'chat' in url:
                log("[OK] Past handle page!")
                break

        # Step 7: Fill handle
        log(f"[7] Handle: {handle}")
        page.evaluate("""(h) => {
            const inputs = document.querySelectorAll('input');
            for (const inp of inputs) {
                const ph = (inp.placeholder || '').toLowerCase();
                if (ph.includes('you') || ph.includes('handle') || ph.includes('username')) {
                    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
                    setter.call(inp, h);
                    inp.dispatchEvent(new Event('input', { bubbles: true }));
                    return 'ok: ' + inp.value;
                }
            }
            for (const inp of inputs) {
                if (inp.type !== 'hidden' && inp.offsetParent !== null) {
                    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
                    setter.call(inp, h);
                    inp.dispatchEvent(new Event('input', { bubbles: true }));
                    return 'ok2: ' + inp.value;
                }
            }
            return 'no input found';
        }""", handle)
        time.sleep(1)

        # Click Continue
        page.evaluate("""() => {
            for (const btn of document.querySelectorAll('button')) {
                if (btn.textContent.trim() === 'Continue' && !btn.disabled) { btn.click(); return 'ok'; }
            }
        }""")
        time.sleep(5)
        screenshot(page, f"{email_name}_step7")

        # Step 8: Wait for boot
        log("[8] Waiting for boot...")
        for i in range(48):
            time.sleep(10)
            url = page.url
            body = page.evaluate("() => document.body.innerText.substring(0, 200)")
            pct = re.search(r'(\d+\.?\d*)%', body)
            pct_str = pct.group(1) + "%" if pct else "?"
            log(f"  [{i+1}] Boot: {pct_str} | {url[:50]}")

            if 'go to your zo' in body.lower():
                log("[OK] Boot complete! Clicking...")
                page.evaluate("""() => {
                    for (const el of document.querySelectorAll('*')) {
                        if ('go to your zo' in el.textContent.trim().toLowerCase()) { el.click(); return 'ok'; }
                    }
                }""")
                time.sleep(3)
                break
            if 'dashboard' in url or '/home' in url or 'chat' in url:
                log("[OK] Dashboard reached!")
                break

        # Record success
        result = {"email": email_name, "handle": handle, "url": f"https://{handle}.zo.computer",
                   "time": datetime.now(timezone.utc).isoformat(), "status": "success"}
        with open(RESULTS_FILE, "a") as f:
            f.write(json.dumps(result) + "\n")

        # Move email file
        dest = os.path.join(REGISTERED_DIR, Path(email_file).name)
        os.rename(email_file, dest)

        log(f"[SUCCESS] {email_name} -> {handle} -> https://{handle}.zo.computer")
        screenshot(page, f"{email_name}_SUCCESS")
        return "success"

    except Exception as e:
        log(f"[ERROR] {email_name}: {e}")
        try:
            if 'page' in dir() and page:
                screenshot(page, f"{email_name}_ERROR")
        except:
            pass
        result = {"email": email_name, "status": "error", "error": str(e),
                   "time": datetime.now(timezone.utc).isoformat()}
        with open(RESULTS_FILE, "a") as f:
            f.write(json.dumps(result) + "\n")
        return "error"

    finally:
        if browser:
            try: browser.close()
            except: pass
        if pw:
            try: pw.stop()
            except: pass
        # Force cleanup
        import gc
        gc.collect()

def main():
    if len(sys.argv) > 1:
        # Register single email
        register_one(sys.argv[1])
        return

    # Batch mode
    registered = set()
    if os.path.exists(RESULTS_FILE):
        with open(RESULTS_FILE) as f:
            for line in f:
                try:
                    d = json.loads(line)
                    if d.get("status") in ("success",):
                        registered.add(d["email"])
                except: pass

    pending = []
    for f in sorted(Path(EMAIL_DIR).glob("*.txt")):
        name = f.stem.replace("tokens_", "").replace("_combo", "")
        if name not in registered:
            pending.append(f)

    log(f"Registered: {len(registered)} | Pending: {len(pending)}")

    for i, email_file in enumerate(pending):
        log(f"\n[{i+1}/{len(pending)}] {email_file.name}")
        result = register_one(email_file)
        log(f"Result: {result}")
        wait = 15 if result == "success" else 20
        log(f"Waiting {wait}s...")
        time.sleep(wait)

    log("All done!")

if __name__ == "__main__":
    main()
