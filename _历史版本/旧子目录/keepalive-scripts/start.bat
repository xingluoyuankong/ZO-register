@echo off
chcp 65001 >nul
echo ============================================
echo   ZO Keep-Alive 启动器
echo ============================================
echo.

:: 检查 Playwright 是否已安装
where npx >nul 2>nul
if %errorlevel% neq 0 (
    echo [错误] 未找到 npx，请先安装 Node.js
    pause
    exit /b 1
)

echo [1/3] 启动 Edge 浏览器（CDP 模式 + Turnstile Patcher 扩展）...
echo.

set EDGE_PATH=C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe
set CHROME_PATH=C:\Users\XZXyuan\AppData\Local\Google\Chrome\Application\chrome.exe
set EXT_PATH=E:\API获取工具\ZO注册\keepalive\turnstile-patch
set USER_DATA=%APPDATA%\zo-keepalive

:: 优先使用 Edge（更不容易被 Cloudflare 检测）
if exist "%EDGE_PATH%" (
    echo 使用 Edge 浏览器
    start "" "%EDGE_PATH%" ^
        --remote-debugging-port=9222 ^
        --user-data-dir="%USER_DATA%" ^
        --load-extension="%EXT_PATH%" ^
        --disable-extensions-except="%EXT_PATH%" ^
        --no-first-run ^
        --no-default-browser-check ^
        --disable-sync ^
        --disable-infobars ^
        --window-size=1440,900
) else if exist "%CHROME_PATH%" (
    echo 使用 Chrome 浏览器
    start "" "%CHROME_PATH%" ^
        --remote-debugging-port=9222 ^
        --user-data-dir="%USER_DATA%" ^
        --load-extension="%EXT_PATH%" ^
        --disable-extensions-except="%EXT_PATH%" ^
        --no-first-run ^
        --no-default-browser-check ^
        --disable-sync ^
        --disable-infobars ^
        --window-size=1440,900
) else (
    echo [错误] 未找到 Edge 或 Chrome 浏览器
    pause
    exit /b 1
)

echo.
echo [2/3] 等待浏览器启动（5秒）...
timeout /t 5 /nobreak >nul

echo.
echo [3/3] 启动保活脚本...
echo.
node keepalive.js

pause
