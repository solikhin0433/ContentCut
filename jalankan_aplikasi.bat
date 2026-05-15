@echo off
echo Menjalankan Video Cutter App...
cd /d "%~dp0"
call venv\Scripts\activate
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
pause
