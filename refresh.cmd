@echo off
rem Double-click to download the latest job list and open the tracker.
cd /d "%~dp0"
node build.js || (pause & exit /b 1)
start "" "%~dp0jobs.html"
