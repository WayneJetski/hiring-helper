@echo off
REM Hiring Helper launcher: double-click this file.
REM All the work happens in scripts\launcher\start.ps1; this stub only gets
REM PowerShell running with a policy that allows it, then keeps the window
REM open if something went wrong so the message can be read.
chcp 65001 >nul
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\launcher\start.ps1"
if errorlevel 1 (
  echo.
  echo Hiring Helper stopped because of the problem above.
  pause
)
