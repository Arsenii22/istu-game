@echo off
chcp 65001 >nul
rem Сборка данных из таблиц data-src в js/data. Запуск двойным щелчком.
cd /d "%~dp0.."
node tools\build-data.js
echo.
pause
