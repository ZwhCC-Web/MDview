@echo off
setlocal
cd /d "%~dp0"
echo ==== ChipBench desktop build ====
where cargo >nul 2>nul || (echo [X] Rust not found. Install from https://rustup.rs ^(MSVC toolchain + VS Build Tools "Desktop development with C++"^) & pause & exit /b 1)
where node  >nul 2>nul || (echo [X] Node.js not found. Install Node.js 18+ from https://nodejs.org & pause & exit /b 1)
call npm install || goto :fail
rem 1.6: always regenerate the icon set (an old src-tauri\icons folder would keep the old exe icon)
call npx tauri icon app-icon.png || goto :fail
if defined CHIPBENCH_CERT_THUMBPRINT (
  echo Signing with certificate %CHIPBENCH_CERT_THUMBPRINT%
  call npx tauri build --config "{\"bundle\":{\"windows\":{\"certificateThumbprint\":\"%CHIPBENCH_CERT_THUMBPRINT%\"}}}" || goto :fail
) else (
  echo [!] No code-signing certificate: Windows SmartScreen will warn when the exe / installer is first run. See docs\SIGNING.md
  call npx tauri build || goto :fail
)
echo.
echo ==== Done ====
echo Installer : src-tauri\target\release\bundle\nsis\
echo Portable  : src-tauri\target\release\chipbench.exe
explorer src-tauri\target\release\bundle\nsis
pause
exit /b 0
:fail
echo Build failed. Copy the messages above and send them back.
pause
exit /b 1
