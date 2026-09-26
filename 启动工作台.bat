@echo off
rem 双击启动工作台
cd /d "%~dp0"
start "" "node_modules\electron\dist\electron.exe" .
