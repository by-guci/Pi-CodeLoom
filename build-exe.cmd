@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\build-exe.ps1"
set "build_exit_code=%ERRORLEVEL%"
echo.
pause
exit /b %build_exit_code%
