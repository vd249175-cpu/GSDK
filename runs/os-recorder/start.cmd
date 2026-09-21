@echo off
setlocal
chcp 65001 >nul

for %%I in ("%~dp0.") do set "RUN_DIR=%%~fI"
for %%I in ("%RUN_DIR%\..\..") do set "REPO_ROOT=%%~fI"

set "GIT_EXE="
for /f "delims=" %%I in ('where git 2^>nul') do if not defined GIT_EXE set "GIT_EXE=%%~fI"
if not defined GIT_EXE goto :missing_git_bash

for %%I in ("%GIT_EXE%") do set "GIT_CMD_DIR=%%~dpI"
for %%I in ("%GIT_CMD_DIR%..") do set "GIT_ROOT=%%~fI"
set "BASH_CMD=%GIT_ROOT%\bin\bash.exe"
if not exist "%BASH_CMD%" goto :missing_git_bash

echo ============================================================
echo   GraphFramework · 正在启动 os-recorder...
echo ============================================================

"%BASH_CMD%" "%REPO_ROOT%\run.sh" start "%RUN_DIR%\run.config.json" %*
if errorlevel 1 goto :on_start_error

echo.
echo ============================================================
echo   GraphFramework · os-recorder 运行已就绪
echo   --------------------------------------------------------
echo   - 权威微内核与服务正在运行中
echo   - 按任意键或运行 stop.cmd 即可退出并优雅停机
echo ============================================================
echo.
pause

echo.
echo 正在停止 os-recorder 并释放资源...
"%BASH_CMD%" "%REPO_ROOT%\run.sh" stop "%RUN_DIR%\run.config.json"
set "EXIT_CODE=%ERRORLEVEL%"
if not "%EXIT_CODE%"=="0" exit /b %EXIT_CODE%
echo os-recorder 已成功停机。
exit /b 0

:missing_git_bash
echo [ERROR] 未找到 Git Bash。请安装 Git for Windows 并确保 git.exe 可通过 PATH 访问。 >&2
pause
exit /b 1

:on_start_error
set "EXIT_CODE=%ERRORLEVEL%"
echo.
echo [ERROR] 启动失败，退出码: %EXIT_CODE%
echo 请在日志目录排查详细原因: "%RUN_DIR%\.generated\logs\supervisor.log"
echo.
pause
exit /b %EXIT_CODE%
