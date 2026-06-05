# ZO Computer 批量注册

## 📁 文件结构

```
ZO-register/
├── zo_batch_register.cjs    # 主注册脚本（批量）
├── zo_register_playwright.py # Playwright + Stealth 注册脚本
├── auto-register.sh          # Bash 自动注册脚本
├── registered/               # 已注册邮箱存放目录
│   ├── results.jsonl         # 注册结果记录
│   ├── results.json          # 注册结果 JSON
│   ├── ACCOUNTS.md           # 账号汇总
│   ├── SUMMARY.md            # 注册结果汇总
│   ├── screenshots/          # 失败截图目录
│   └── *.txt                 # 已注册邮箱凭证
├── GUIDE.md                  # 踩坑指南
├── REGISTER_SUCCESS.md       # 成功案例记录
└── README.md                 # 本文件
```

## 🔑 邮箱文件格式

每个 `.txt` 文件，文件名=邮箱地址，内容4段用 `----` 分隔：

```
邮箱----密码----clientId----refreshToken
```

## 🚀 快速开始

### 方案一：agent-browser（推荐）

```bash
# 1. 确保邮箱文件在 extracted_emails/ 目录
# 2. 运行注册脚本
python3 zo_register_one.py <邮箱文件路径>
```

### 方案二：Playwright + Stealth

```bash
# 批量注册
python3 zo_register_playwright.py
```

### 方案三：Node.js + Puppeteer

```bash
# 需要 Chrome CDP 端口 64610 已开启
node zo_batch_register.cjs
```

## 📋 注册流程

1. 打开 `https://www.zo.computer/signup`
2. 点击 "Email me a sign-up link"
3. 填写邮箱 → 点 Continue
4. 通过 Graph API 轮询收件箱获取魔法链接
5. 打开魔法链接，等待 Cloudflare Turnstile 自动完成
6. 点击 "Continue in browser"
7. 生成随机 handle → 点 Continue
8. 等待 ZO 计算机启动完成
9. 点击 "Go to your Zo" → 注册完成

## 📝 输出文件

- `registered/results.jsonl`：每行一个 JSON，包含 email、handle、status、time
- `registered/ACCOUNTS.md`：账号汇总表
- `registered/screenshots/`：失败截图（用于调试）

## ⚠️ 踩坑记录

详见 [GUIDE.md](./GUIDE.md)

## ✅ 成功案例

详见 [REGISTER_SUCCESS.md](./REGISTER_SUCCESS.md)

## 📊 当前状态

- ✅ 完全成功：1 个邮箱
- ⚠️ Handle 已保留（待 boot）：3 个邮箱
- 📧 待注册：20+ 个邮箱