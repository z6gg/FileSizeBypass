@echo off
setlocal enabledelayedexpansion

echo Checking for required tools...

set NEEDS_REFRESH=0

where git >nul 2>nul
if errorlevel 1 (
    echo Git not found, installing...
    winget install --id Git.Git -e --source winget
    set NEEDS_REFRESH=1
) else (
    echo Git found.
)

where node >nul 2>nul
if errorlevel 1 (
    echo Node.js not found, installing...
    winget install --id OpenJS.NodeJS.LTS -e --source winget
    set NEEDS_REFRESH=1
) else (
    echo Node.js found.
)

if !NEEDS_REFRESH!==1 (
    echo Refreshing PATH so newly installed tools are usable in this window...
    for /f "usebackq tokens=*" %%i in (`powershell -NoProfile -Command "[System.Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [System.Environment]::GetEnvironmentVariable('Path','User')"`) do set "PATH=%%i"
)

where pnpm >nul 2>nul
if errorlevel 1 (
    echo pnpm not found, installing...
    call npm install -g pnpm
    for /f "usebackq tokens=*" %%i in (`powershell -NoProfile -Command "[System.Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [System.Environment]::GetEnvironmentVariable('Path','User')"`) do set "PATH=%%i"
) else (
    echo pnpm found.
)

echo All required tools are ready.
echo.

if exist VencordBuild\Vencord\src\userplugins\FileSizeBypass (
    echo Existing install found, updating...
    cd VencordBuild\Vencord
    git pull
    cd src\userplugins\FileSizeBypass
    git pull
    cd ..\..\..
) else (
    echo No existing install found, installing fresh...
    mkdir VencordBuild
    cd VencordBuild
    git clone https://github.com/Vendicated/Vencord.git
    cd Vencord
    call pnpm install
    mkdir src\userplugins\
    cd src\userplugins\
    git clone https://github.com/z6gg/FileSizeBypass.git
    cd ..\..
)

call pnpm build
call pnpm inject

pause