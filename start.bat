@echo off
REM Start Felt Sharpener with the local AI-coach harness (Windows).
cd /d "%~dp0"
where py >nul 2>nul && (py -3 server\harness.py %* & goto :eof)
where python >nul 2>nul && (python server\harness.py %* & goto :eof)
echo Python 3 not found. You can still play by opening index.html in your browser.
pause
