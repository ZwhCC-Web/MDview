@echo off
setlocal
cd /d "%~dp0"
echo ==== ChipBench installer build ====
where cargo >nul 2>nul || (echo [X] Rust not found. Install from https://rustup.rs ^(MSVC toolchain + VS Build Tools "Desktop development with C++"^) & goto :fail)
where node  >nul 2>nul || (echo [X] Node.js 18+ not found: https://nodejs.org & goto :fail)
where python >nul 2>nul || (echo [X] Python 3.8+ not found: https://python.org & goto :fail)
echo [1/5] Pre-build checks
python tools\make-installer.py --check || goto :fail
echo [2/5] Rust unit tests (first real compile of the Rust shell)
pushd src-tauri
cargo test || (popd & goto :fail)
popd
echo [3/5] npm install + icon set
call npm install || goto :fail
call npx tauri icon app-icon.png || goto :fail
echo [4/5] tauri build
if defined CHIPBENCH_CERT_THUMBPRINT (
  call npx tauri build --config "{\"bundle\":{\"windows\":{\"certificateThumbprint\":\"%CHIPBENCH_CERT_THUMBPRINT%\"}}}" || goto :fail
) else (
  echo     [!] unsigned: SmartScreen will warn on first run, see docs\SIGNING.md
  call npx tauri build || goto :fail
)
echo [5/5] Collect installers
python tools\make-installer.py --collect || goto :fail
echo ==== Done: dist\ChipBench-*\  (setup.exe, x64.msi, portable.exe, SHA256SUMS.txt, INSTALL.txt) ====
for /d %%D in (dist\ChipBench-*) do explorer "%%D"
pause
exit /b 0
:fail
echo.
echo Build failed. Copy the messages above and send them back - the first real compile may need small fixes.
pause
exit /b 1
