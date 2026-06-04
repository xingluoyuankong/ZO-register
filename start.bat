@echo off
chcp 65001 >nul 2>&1
title ZO Batch Register
cd /d "%~dp0"
echo.
echo  ========================================
echo  ZO Computer Batch Register
echo  ========================================
echo.
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":3456" ^| findstr "LISTENING"') do taskkill /PID %%p /F >nul 2>&1
echo [START] Starting server...
start /b node server.cjs
:wait_server
timeout /t 1 /nobreak >nul
netstat -ano | findstr ":3456" | findstr "LISTENING" >nul 2>&1
if errorlevel 1 goto wait_server
echo [OPEN] Opening frontend...
start http://localhost:3456
echo  Server running at http://localhost:3456
echo.
:loop
timeout /t 5 /nobreak >nul
goto loop
