@echo off
cd /d "%~dp0"
echo A Place on earth is starting. Keep this window open.
echo Press Ctrl+C to stop the server.
node backend/server.cjs
pause
