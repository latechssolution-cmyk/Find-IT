@echo off
REM FIND IT sweep supervisor launcher.
REM Owned by Task Scheduler so it outlives any shell/session. The supervisor
REM takes a single-instance lock, so re-running this is always safe.
cd /d "%~dp0"
python -u sweep.py >> "sweeps\supervisor.out.log" 2>&1
