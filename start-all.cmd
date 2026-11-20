@echo off
rem ============================================================
rem  Wanderlust one-click launcher (Windows)
rem    1. PC backend / API   -> api\  (node --env-file=.env, port 8080)
rem    2. Mini program A     -> mini-a (tourist)   via WeChat DevTools CLI
rem    3. Mini program B     -> mini-b (merchant)  via WeChat DevTools CLI
rem    4. Open admin UI in default browser
rem
rem  Usage:  double-click, or  start-all.cmd [nobrowser] [noapp]
rem    nobrowser : do not open the admin page
rem    noapp     : start backend only, skip the two mini programs
rem  Override CLI path:  set WECHAT_CLI=D:\...\cli.bat
rem ============================================================
setlocal EnableExtensions

set "ROOT=%~dp0"
set "API=%ROOT%api"
set "MINI_A=%ROOT%mini-a"
set "MINI_B=%ROOT%mini-b"
if "%PORT%"=="" set "PORT=8080"
set "HEALTH=http://127.0.0.1:%PORT%/c/health"
set "ADMIN_URL=http://127.0.0.1:%PORT%/admin-ui"

set "OPT_BROWSER=1"
set "OPT_APP=1"
for %%A in (%*) do (
  if /I "%%A"=="nobrowser" set "OPT_BROWSER=0"
  if /I "%%A"=="noapp" set "OPT_APP=0"
)

echo.
echo ===== [1/3] PC backend (API) =====
where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] node not found in PATH. Install Node.js first.
  goto :fail
)
if not exist "%API%\.env" (
  echo [ERROR] %API%\.env not found. Copy api\.env.example to api\.env and fill it in.
  goto :fail
)

rem Always restart: stop the running API first (old instance, or one started by
rem start-8080.cmd with the wrong JWT_SECRET), then start a fresh one from api\.env.
rem The owner is found by command line (see stop-api.ps1): netstat reports PID 0 for the
rem :%PORT% listener on this machine, so it cannot be resolved from the port.
echo Stopping any running API ...
powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%stop-api.ps1"
rem fallback: any other process netstat can still attribute to the port
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:":%PORT% .*LISTENING"') do (
  if not "%%P"=="0" (
    echo Port %PORT% is held by PID %%P - stopping it:
    tasklist /FI "PID eq %%P" /NH
    taskkill /F /T /PID %%P >nul 2>&1
  )
)

rem wait until nothing answers on the port any more
set /a FREE=0
:free_loop
curl -s -o nul --max-time 1 "%HEALTH%" >nul 2>&1
if errorlevel 1 goto :port_free
set /a FREE+=1
if %FREE% GEQ 15 (
  echo [ERROR] Something on port %PORT% still answers after about 15 seconds - stop it manually.
  goto :fail
)
ping -n 2 127.0.0.1 >nul
goto :free_loop
:port_free

echo Starting backend in a new window ...
start "wanderlust-api" /D "%API%" cmd /k node --env-file=.env src/index.mjs

:wait_api
echo Waiting for %HEALTH% ...
set /a TRIES=0
:wait_loop
curl -s -f -o nul --max-time 2 "%HEALTH%" >nul 2>&1
if not errorlevel 1 goto :api_ok
set /a TRIES+=1
if %TRIES% GEQ 40 (
  echo [ERROR] Backend did not become healthy within about 80 seconds.
  echo         Check the "wanderlust-api" window for errors ^(DB running? .env correct? port %PORT% taken?^).
  goto :fail
)
ping -n 3 127.0.0.1 >nul
goto :wait_loop

:api_ok
echo Backend is up: %ADMIN_URL%

if "%OPT_APP%"=="0" goto :browser

echo.
echo ===== [2/3] WeChat DevTools: mini-a and mini-b =====
set "CLI=%WECHAT_CLI%"
if defined CLI if exist "%CLI%" goto :cli_found
set "CLI="
rem folder name is Chinese, so enumerate Tencent\* instead of hard-coding it
for %%R in (
  "D:\Program Files (x86)\Tencent"
  "D:\Program Files\Tencent"
  "C:\Program Files (x86)\Tencent"
  "C:\Program Files\Tencent"
  "%LOCALAPPDATA%\Programs\Tencent"
) do (
  if exist "%%~R\" (
    for /d %%D in ("%%~R\*") do (
      if not defined CLI if exist "%%~D\cli.bat" set "CLI=%%~D\cli.bat"
    )
  )
)
:cli_found
if not defined CLI (
  echo [WARN] WeChat DevTools cli.bat not found. Open these folders in DevTools manually:
  echo        %MINI_A%
  echo        %MINI_B%
  goto :browser
)
echo CLI: %CLI%

echo Opening mini-a ^(tourist^) ...
call :open_mini mini-a "%MINI_A%"
rem give DevTools time to finish the first project before opening the second
ping -n 6 127.0.0.1 >nul
echo Opening mini-b ^(merchant^) ...
call :open_mini mini-b "%MINI_B%"
if defined APP_FAIL (
  echo.
  echo [WARN] Failed to open:%APP_FAIL%
  echo        "no such AppID" usually means project.config.json has appid touristappid / a wrong id.
  echo        Open that folder manually in DevTools, or set a valid test AppID for it.
)

echo.
echo If DevTools asks you to log in, scan the QR code with WeChat.
echo If the CLI complains about the service port: DevTools - Settings - Security - enable "Service Port".

:browser
if "%OPT_BROWSER%"=="0" goto :done
echo.
echo ===== [3/3] Open admin UI =====
start "" "%ADMIN_URL%"

:done
echo.
echo All done.
echo   Admin UI : %ADMIN_URL%
echo   API log  : "wanderlust-api" window
echo   NOTE: scheduled task WanderlustAPI-KeepAlive restarts :%PORT% when nobody listens.
echo         To really stop the backend, disable that task first ^(Task Scheduler^).
echo.
pause
endlocal
exit /b 0

:open_mini
rem %1 = name, %2 = project dir. cli.bat returns exit code 0 even on failure,
rem so capture its output and look for the "[error]" marker instead.
set "OUTF=%TEMP%\wl_open_%~1.txt"
call "%CLI%" open --project %2 > "%OUTF%" 2>&1
type "%OUTF%" | findstr /V /C:"    at " /C:"DeprecationWarning" /C:"trace-deprecation"
findstr /C:"[error]" "%OUTF%" >nul && set "APP_FAIL=%APP_FAIL% %~1"
del "%OUTF%" >nul 2>&1
exit /b 0

:fail
echo.
echo Launch aborted.
pause
endlocal
exit /b 1
