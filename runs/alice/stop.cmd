@echo off
setlocal
chcp 65001 >nul
pushd "%~dp0"
set "RUN_DIR=%CD%"
cd ..\..
set "REPO_ROOT=%CD%"
popd

set "BASH_CMD="
where bash >nul 2>&1
if %ERRORLEVEL% equ 0 (
  set "BASH_CMD=bash"
) else if exist "C:\Program Files\Git\bin\bash.exe" (
  set "BASH_CMD=C:\Program Files\Git\bin\bash.exe"
) else (
  echo [ERROR] 未找到 Git bash。 >&2
  pause
  exit /b 1
)

echo 正在停止 GraphFramework alice 运行...
"%BASH_CMD%" "%REPO_ROOT%\run.sh" stop "%RUN_DIR%\run.config.json" %*
if errorlevel 1 goto :on_stop_error

echo alice 运行已停止，资源已释放。
exit /b 0

:on_stop_error
echo.
echo [ERROR] 停机失败，退出码: %ERRORLEVEL%
pause
exit /b %ERRORLEVEL%