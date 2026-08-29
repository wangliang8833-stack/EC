@echo off
setlocal
title Ecommerce Multi-shop Platform - Development Test

cd /d "%~dp0"

echo [1/4] Checking Node.js...
where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js was not found. Install Node.js 24 and try again.
  goto :failed
)

for /f %%V in ('node -p "process.versions.node.split('.')[0]"') do set "NODE_MAJOR=%%V"
if not defined NODE_MAJOR (
  echo [ERROR] Unable to read the Node.js version.
  goto :failed
)
if %NODE_MAJOR% LSS 24 (
  echo [ERROR] Node.js %NODE_MAJOR% detected. Node.js 24 or later is required.
  goto :failed
)
echo       Node.js is ready:
node --version

echo [2/4] Checking pnpm...
where pnpm >nul 2>nul
if not errorlevel 1 (
  set "PNPM_COMMAND=pnpm"
) else (
  where corepack >nul 2>nul
  if errorlevel 1 (
    echo [ERROR] pnpm and Corepack were not found. Install pnpm 10.33.2.
    goto :failed
  )
  set "PNPM_COMMAND=corepack pnpm"
)
call %PNPM_COMMAND% --version
if errorlevel 1 (
  echo [ERROR] pnpm could not run successfully.
  goto :failed
)

echo [3/4] Checking project dependencies...
set "NEED_INSTALL=0"
if not exist "node_modules\.modules.yaml" set "NEED_INSTALL=1"
if not exist "apps\desktop\node_modules\electron\dist\electron.exe" set "NEED_INSTALL=1"
if "%NEED_INSTALL%"=="1" (
  echo       Dependencies are missing. Installing from the lockfile...
  call %PNPM_COMMAND% install --frozen-lockfile
  if errorlevel 1 (
    echo [ERROR] Dependency installation failed. Review the output above.
    goto :failed
  )
) else (
  echo       Project dependencies are ready.
)

if /i "%~1"=="--check" (
  echo [4/4] Self-check passed. The application was not started.
  exit /b 0
)

echo [4/4] Starting the Electron application...
echo       This window will show the exit result after the dev server stops.
echo.
call %PNPM_COMMAND% dev
set "APP_EXIT_CODE=%ERRORLEVEL%"
if not "%APP_EXIT_CODE%"=="0" (
  echo.
  echo [ERROR] The application exited with code %APP_EXIT_CODE%.
  goto :failed
)

echo.
echo The application has stopped.
pause
exit /b 0

:failed
echo.
echo Keep this window open and use the error output above for troubleshooting.
pause
exit /b 1
