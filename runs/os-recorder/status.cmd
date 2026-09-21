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

"%BASH_CMD%" "%REPO_ROOT%\run.sh" status "%RUN_DIR%\run.config.json" %*
exit /b %ERRORLEVEL%

:missing_git_bash
echo [ERROR] 未找到 Git Bash。请安装 Git for Windows 并确保 git.exe 可通过 PATH 访问。 >&2
exit /b 1
