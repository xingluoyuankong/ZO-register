const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer-core");

const CHROME_PATH = "C:\\Users\\XZXyuan\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe";
const EMAIL_FILE = "C:\\Users\\XZXyuan\\Downloads\\批量注册邮箱\\已经使用\\sanchezquinncu3w1kkhtuc74@outlook.com.txt";

const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = msg => console.log(`[${new Date().toISOString()}] ${msg}`);

async function sendMagicLink(page, email) {
    try { await page.goto("https://www.zo.computer/signup", { waitUntil: "networkidle", timeout: 30000 }); } catch(e) {}
    await sleep(3000);
    await page.evaluate(() => {
        for (const btn of document.querySelectorAll("button, a")) {
            if (/email/i.test(btn.textContent || "") && btn.offsetParent) { btn.click(); return; }
        }
    });
    await sleep(2000);
    await page.evaluate(em => {
        const inp = document.querySelector('input[type="email"]') || document.querySelector("input");
        if (inp) {
            const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
            s.call(inp, em);
            inp.dispatchEvent(new Event("input", { bubbles: true }));
        }
    }, email);
    await sleep(500);
    await page.evaluate(() => {
        for (const btn of document.querySelectorAll("button")) {
            if (/continue/i.test(btn.textContent || "")) { btn.click(); return; }
        }
    });
    await sleep(3000);
    log("Magic link sent");
}

async function pollMagicLink(clientId, refreshToken) {
    let rt = refreshToken;
    for (let i = 0; i < 30; i++) {
        try {
            const body = new URLSearchParams({
                client_id: clientId, grant_type: "refresh_token", refresh_token: rt,
                scope: "https://graph.microsoft.com/.default offline_access"
            });
            const tr = await fetch("https://login.microsoftonline.com/consumers/oauth2/v2.0/token", {
                method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: body.toString()
            });
            const td = await tr.json();
            if (td.error) { await sleep(3000); continue; }
            rt = td.refresh_token || rt;
            const mr = await fetch(
                "https://graph.microsoft.com/v1.0/me/messages?$top=10&$select=subject,body,receivedDateTime&$orderby=receivedDateTime%20desc",
                { headers: { Authorization: "Bearer " + td.access_token } }
            );
            const md = await mr.json();
            for (const msg of (md.value || [])) {
                if (new Date(msg.receivedDateTime) < new Date(Date.now() - 120000)) continue;
                const c = (msg.subject || "") + " " + (msg.body?.content || "");
                if (!/zo/i.test(c)) continue;
                const links = c.match(/https?:\/\/[^\s"'<>]*zo\.computer[^\s"'<>]*/gi) || [];
                for (let l of links) {
                    l = l.replace(/[)\]>,;!?\s]+$/, "").replace(/&amp;/g, "&");
                    if (/token=|verify|login/i.test(l)) { log("Found magic link"); return { link: l, newRt: rt }; }
                }
            }
        } catch (e) {}
        await sleep(3000);
        process.stdout.write(".");
    }
    return null;
}

async function main() {
    const emailContent = fs.readFileSync(EMAIL_FILE, "utf-8").trim();
    const [EMAIL, PASSWORD, CLIENT_ID, REFRESH_TOKEN] = emailContent.split("----").map(s => s.trim());
    log("Using: " + EMAIL);

    // Step 1: Send magic link
    log("Step 1: Sending magic link...");
    const sendBrowser = await puppeteer.launch({
        executablePath: CHROME_PATH, headless: false,
        args: ["--no-first-run", "--disable-blink-features=AutomationControlled", "--window-size=1440,900", "--no-sandbox"],
        ignoreDefaultArgs: ["--enable-automation"],
    });
    const sendPage = (await sendBrowser.pages())[0] || await sendBrowser.newPage();
    await sendMagicLink(sendPage, EMAIL);
    await sendBrowser.close();
    log("Sender browser closed");

    // Step 2: Poll for magic link
    log("Step 2: Polling inbox...");
    const result = await pollMagicLink(CLIENT_ID, REFRESH_TOKEN);
    if (!result) { log("No magic link found"); return; }

    // Step 3: Open with MINIMAL browser (no stealth, no extension, no evaluateOnNewDocument)
    log("Step 3: Opening with vanilla Chrome...");
    const browser = await puppeteer.launch({
        executablePath: CHROME_PATH, headless: false,
        args: ["--no-first-run", "--disable-blink-features=AutomationControlled", "--window-size=1440,900", "--no-sandbox"],
        ignoreDefaultArgs: ["--enable-automation"],
    });
    const page = (await browser.pages())[0] || await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });

    log("Navigating to: " + result.link.substring(0, 80) + "...");
    await page.goto(result.link, { waitUntil: "networkidle", timeout: 60000 }).catch(e => log("goto: " + e.message));

    log("Waiting for Turnstile (max 120s)...");
    let passed = false;
    for (let i = 0; i < 60; i++) {
        await sleep(2000);
        const info = await page.evaluate(() => {
            const url = location.href;
            const txt = (document.body?.innerText || "").substring(0, 300);
            const iframes = document.querySelectorAll("iframe");
            let frameUrls = [];
            for (const f of iframes) {
                const src = (f.src || "").toLowerCase();
                if (src.includes("turnstile") || src.includes("challenges")) frameUrls.push(src.substring(0, 60));
            }
            let token = "";
            try { if (typeof turnstile !== "undefined") token = turnstile.getResponse() || ""; } catch(e) {}
            const inp = document.querySelector('input[name="cf-turnstile-response"]');
            if (inp && inp.value) token = inp.value;
            return { url, txt: txt.substring(0, 150), frames: frameUrls.length, token: token ? token.substring(0, 20) : "" };
        });

        const tsInfo = info.token ? "TOKEN:"+info.token : (info.frames>0 ? `${info.frames} frames` : "no frame");
        log(`[${i*2}s] ${tsInfo} | ${info.url.substring(0, 50)} | "${info.txt.substring(0, 80)}"`);

        if (info.url.includes("zo.computer") && !info.url.includes("signup") && !info.url.includes("token=")) {
            log("PASSED: " + info.url); passed = true; break;
        }
        if (info.url.includes("/signup")) {
            log("PASSED to signup: " + info.url); passed = true; break;
        }
    }

    log(passed ? "SUCCESS" : "FAILED after 120s");
    log("Browser staying open for manual check");
}

main().catch(e => log("FATAL: " + e.message));
