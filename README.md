# ZO Computer 批量注册

## 文件结构

```
E:\API获取工具\ZO注册\
├── zo_batch_register.cjs    # 主注册脚本（批量）
├── registered/              # 已注册邮箱存放目录
│   ├── results.jsonl        # 注册结果记录
│   └── *.txt                # 已注册邮箱凭证
└── README.md
```

## 邮箱文件格式

每个 `.txt` 文件，文件名=邮箱地址，内容4段用 `----` 分隔：

```
邮箱----密码----clientId----refreshToken
```

## 用法

```bash
# 批量注册（默认扫描 已经使用 文件夹）
node zo_batch_register.cjs

# 指定邮箱文件夹
node zo_batch_register.cjs "C:\path\to\emails"
```

## 前置条件

1. Chrome 浏览器已启动，CDP 端口 64610 已开启
2. OpenClaw 浏览器已启动（`browser start`）
3. 邮箱文件已准备好，格式正确

## 注册流程

1. 打开 `https://www.zo.computer/signup`
2. 点击 "Email me a sign-up link"
3. 填写邮箱 → 点 Continue
4. 通过 Graph API 轮询收件箱获取魔法链接
5. 打开魔法链接，等待 Cloudflare Turnstile 自动完成
6. 点击 "Continue in browser"
7. 生成随机 handle → 点 Continue
8. 等待 ZO 计算机启动完成
9. 点击 "Go to your Zo" → 注册完成

## 输出

- `registered/results.jsonl`：每行一个 JSON，包含 email、handle、status、time
- `registered/*.txt`：注册成功后邮箱凭证自动移入此目录
