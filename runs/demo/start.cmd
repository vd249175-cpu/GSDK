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
  echo [ERROR] 未找到 Git bash。请安装 Git for Windows 并确认路径。 >&2
  pause
  exit /b 1
)

echo ============================================================
echo   GraphFramework · 正在启动 demo (达芬奇工作台)...
echo ============================================================

"%BASH_CMD%" "%REPO_ROOT%\run.sh" start "%RUN_DIR%\run.config.json" %*
if errorlevel 1 goto :on_start_error

echo.
echo ============================================================
echo   GraphFramework · demo 运行已就绪
echo   --------------------------------------------------------
echo   - 权威微内核与达芬奇工作台正在运行中
echo   - 请保持此控制台窗口开启以维持运行
echo   - 按任意键或运行 stop.cmd 即可退出并优雅停机
echo ============================================================
echo.
pause

echo.
echo 正在停止 demo 并释放资源...
"%BASH_CMD%" "%REPO_ROOT%\run.sh" stop "%RUN_DIR%\run.config.json"
echo demo 已成功停机。
exit /b 0

:on_start_error
echo.
echo [ERROR] 启动失败，退出码: %ERRORLEVEL%
echo 请在日志目录排查详细原因: "%RUN_DIR%\.generated\logs\supervisor.log"
echo.
pause
exit /b %ERRORLEVEL%