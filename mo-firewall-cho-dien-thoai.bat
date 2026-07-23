@echo off
REM Tu dong xin quyen Admin
>nul 2>&1 net session
if %errorlevel% neq 0 (
    echo Dang xin quyen Admin...
    powershell -Command "Start-Process '%~f0' -Verb RunAs"
    exit /b
)

echo ============================================
echo   Mo Firewall cho Vite dev server (port 5173-5175)
echo ============================================
echo.

REM Xoa rule cu neu co (tranh trung)
netsh advfirewall firewall delete rule name="Vite Dev (Pixel Flow)" >nul 2>&1

REM Them rule moi cho ca TCP port 5173-5175, tat ca profile (ke ca Public)
netsh advfirewall firewall add rule name="Vite Dev (Pixel Flow)" dir=in action=allow protocol=TCP localport=5173-5175 profile=any

echo.
echo Xong! Da mo port 5173-5175.
echo Bay gio thu vao lai bang dien thoai:  http://192.168.0.102:5174/
echo.
pause
