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

echo 正在停止 GraphFramework os-recorder 运行...
"%BASH_CMD%" "%REPO_ROOT%\run.sh" stop "%RUN_DIR%\run.config.json" %*
if errorlevel 1 goto :on_stop_error

echo os-recorder 运行已停止，资源已释放。
exit /b 0

:missing_git_bash
echo [ERROR] 未找到 Git Bash。请安装 Git for Windows 并确保 git.exe 可通过 PATH 访问。 >&2
pause
exit /b 1

:on_stop_error
set "EXIT_CODE=%ERRORLEVEL%"
echo.
echo [ERROR] 停机失败，退出码: %EXIT_CODE%
pause
exit /b %EXIT_CODE%
