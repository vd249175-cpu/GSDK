@echo off
setlocal
set "RUN_DIR=%~dp0"
set "REPO_ROOT=%RUN_DIR%..\..\"
where bash >nul 2>&1
if %ERRORLEVEL% equ 0 (
  bash "%REPO_ROOT%run.sh" status "%RUN_DIR%run.config.json" %*
) else (
  if exist "C:\Program Files\Git\bin\bash.exe" (
    "C:\Program Files\Git\bin\bash.exe" "%REPO_ROOT%run.sh" status "%RUN_DIR%run.config.json" %*
  ) else (
    echo Error: bash was not found in PATH or Git installation. >&2
    exit /b 1
  )
)
