# ZO 注册 - Linux 云部署 + 踩坑指南

## 核心问题 & 解法

### 1. Turnstile → agent-browser
`puppeteer-headless` 过不了 Cloudflare Turnstile。**唯一稳定方案：agent-browser**。
```bash
agent-browser open "MAGIC_LINK"
# 等 5s → snapshot → click @turnstile_ref → 等 redirect
```

### 2. Token 过期（🔑 最致命）
OpenClaw token `exp` 只有 ~3 分钟。Turnstile 解完 token 已过期 → "Invalid or expired"。
**解法：发邮件 → 立