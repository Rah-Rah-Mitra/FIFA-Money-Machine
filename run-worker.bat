@echo off
REM Start the analysis worker (uses the isolated worker venv if present).
setlocal
set ROOT=%~dp0
set PY=%ROOT%worker\.venv\Scripts\python.exe
if not exist "%PY%" set PY=python
"%PY%" "%ROOT%worker\worker.py" %*
