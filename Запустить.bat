@echo off
chcp 65001 >nul
title Музыка
cd /d "%~dp0"
if not exist "node_modules\electron\dist\electron.exe" (
  echo.
  echo   Первый запуск: устанавливаю Electron...
  echo.
  call npm install
)
start "" "node_modules\electron\dist\electron.exe" .
