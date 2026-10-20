@echo off
setlocal
cd /d "%~dp0"
echo ==== MDView Desktop build ====
where cargo >nul 2>nul || (echo [X] Rust not found. Install from https://rustup.rs  ^(MSVC toolchain + VS Build Tools "Desktop development with C++"^) & pause & exit /b 1)
where node  >nul 2>nul || (echo [X] Node.js not found. Install Node.js 18+ from https://nodejs.org & pause & exit /b 1)
call npm install || goto :fail
call npm run libs || goto :fail
if not exist src-tauri\icons\icon.ico call npx tauri icon app-icon.png || goto :fail
call npx tauri build || goto :fail
echo.
echo ==== Done ====
echo Installer : src-tauri\target\release\bundle\nsis\
echo Portable  : src-tauri\target\release\mdview.exe
explorer src-tauri\target\release\bundle\nsis
pause
exit /b 0
:fail
echo Build failed. See messages above.
pause
exit /b 1
