@echo off
chcp 65001 >nul
title GraphFramework 一键启动服务

echo ============================================================
echo   GraphFramework AI 创作工作台 ^& 2D 瑞士内核因果监控
echo ============================================================
echo.

:: 切换到当前脚本所在的项目根目录
cd /d "%~dp0"

:: 环境变量防护：强制本地通信直连，杜绝代理软件拦截
set "NO_PROXY=localhost,127.0.0.1,::1"
set "no_proxy=localhost,127.0.0.1,::1"
set "HTTP_PROXY="
set "HTTPS_PROXY="
set "http_proxy="
set "https_proxy="

echo [1/2] 正在启动 2D 瑞士先锋因果看板 (http://127.0.0.1:5174/)...
start "GraphFramework - 内核因果监控服务" cmd /c "chcp 65001 >nul && npm --prefix "%~dp0..\..\tooling\causal-visualizer" run dev"

echo [2/2] 正在启动 GraphFramework Studio 桌面创作软件...
call npm --prefix "%~dp0.." run start

echo.
echo [GraphFramework] 桌面软件已退出。
