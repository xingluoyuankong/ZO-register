# ZO Batch Register - Plugin

独立插件版本，模块化架构。

## 文件结构

```
plugin/
├── server.js          # Express + WebSocket 服务器
├── zo_register.js     # 核心注册逻辑（独立模块）
├── config.json        # 配置文件
├── start.bat          # 启动脚本
├── public/
│   └── index.html     # 前端 UI
└── registered/        # 已注册邮箱存放
```

## 使用方法

1. 双击 `start.bat` 启动
2. 浏览器打开 `http://localhost:3456`
3. 选择邮箱文件夹，点击刷新
4. 选择浏览器（Edge/Chrome），开始注册

## 依赖

需要 `puppeteer-core`（已安装在上级目录 node_modules）。

## 配置

编辑 `config.json`：
- `emailDir`: 邮箱文件夹路径
- `browserType`: edge 或 chrome
- `concurrency`: 并发数
