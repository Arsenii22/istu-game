@echo off
chcp 65001 >nul
rem Обработка фото из photos-src и сборка данных из таблиц data-src в js/data. Запуск двойным щелчком.
cd /d "%~dp0.."
rem Библиотека sharp для обработки фото ставится один раз, при первом запуске; нужен интернет.
if exist node_modules\sharp goto build
echo Первый запуск: устанавливаю библиотеку для обработки фото.
call npm install
echo.
:build
node tools\build-data.js
echo.
pause
