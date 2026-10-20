@echo off
REM hiring-helper: start, stop and manage Hiring Helper. The work is in scripts\launcher\hiring-helper.ps1.
chcp 65001 >nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\scripts\launcher\hiring-helper.ps1" %*
exit /b %errorlevel%
