# Hiring Helper installer for Windows (PowerShell).
#
#   irm https://raw.githubusercontent.com/WayneJetski/hiring-helper/main/install.ps1 | iex
#
# It installs git if it is missing, downloads Hiring Helper, installs what the app
# needs (Node.js, Claude Code), adds a `hiring-helper` command, starts the app and
# opens it in your browser. It asks a few questions, each with a default (press
# Enter to accept it). Running it again updates an existing install.
#
# To change a default without being asked, set it first in the same PowerShell
# window, for example:
#
#   $env:HH_PORT = '28500'; irm https://raw.githubusercontent.com/WayneJetski/hiring-helper/main/install.ps1 | iex
#
#   HH_DIR           where to install
#   HH_PORT          the port the app listens on
#   HH_BRANCH        which branch to install
#   HH_YES=1         accept every default, ask nothing
#   HH_NO_PATH=1     do not add the hiring-helper command to PATH
#   HH_NO_START=1    install, but do not start the app
#   HH_NO_BROWSER=1  start the app, but do not open the browser
#
# Keep this file ASCII-only: Windows PowerShell 5.1 misreads UTF-8 without a BOM.

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'   # progress bars make downloads very slow in 5.1
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$RepoUrl = if ($env:HH_REPO_URL) { $env:HH_REPO_URL } else { 'https://github.com/WayneJetski/hiring-helper.git' }
$Branch = if ($env:HH_BRANCH) { $env:HH_BRANCH } else { 'main' }
# Not a port other tools use (3000, 5173, 8000, 8080 are all taken by something).
$DefaultPort = 28417

function Write-Step([string]$Message) {
    Write-Host ''
    Write-Host "==> $Message" -ForegroundColor Cyan
}

# Questions need a person at the keyboard; otherwise every default is used.
function Test-CanAsk {
    if ($env:HH_YES) { return $false }
    try { return [Environment]::UserInteractive -and (-not [Console]::IsInputRedirected) }
    catch { return $false }
}

function Read-Answer([string]$Question, [string]$Default) {
    if (-not (Test-CanAsk)) { return $Default }
    $reply = Read-Host "$Question [$Default]"
    if ([string]::IsNullOrWhiteSpace($reply)) { return $Default }
    return $reply.Trim()
}

function Confirm-Yes([string]$Question) {
    if (-not (Test-CanAsk)) { return $true }
    $reply = Read-Host "$Question [Y/n]"
    return ([string]::IsNullOrWhiteSpace($reply) -or $reply -match '^[Yy]')
}

function Test-PortInUse([int]$Port) {
    $client = New-Object Net.Sockets.TcpClient
    try {
        $attempt = $client.BeginConnect('127.0.0.1', $Port, $null, $null)
        return ($attempt.AsyncWaitHandle.WaitOne(300) -and $client.Connected)
    }
    catch { return $false }
    finally { $client.Close() }
}

function Test-ValidPort([string]$Text) {
    $number = 0
    return ([int]::TryParse($Text, [ref]$number) -and $number -ge 1024 -and $number -le 65535)
}

function Get-ExistingPort([string]$Folder) {
    $envFile = Join-Path $Folder '.env'
    if (-not (Test-Path $envFile)) { return $null }
    $line = Get-Content $envFile | Where-Object { $_ -match '^\s*PORT\s*=\s*(\d+)' } | Select-Object -First 1
    if ($line -match '(\d+)') { return $Matches[1] }
    return $null
}

# ------------------------------------------------------------------------ git

function Add-ToSessionPath([string]$Directory) {
    if ((Test-Path $Directory) -and (($env:PATH -split ';') -notcontains $Directory)) {
        $env:PATH = "$Directory;$env:PATH"
    }
}

function Test-GitWorks {
    if (-not (Get-Command git -ErrorAction SilentlyContinue)) { return $false }
    try { & git --version | Out-Null; return ($LASTEXITCODE -eq 0) }
    catch { return $false }
}

function Install-GitIfMissing {
    Write-Step 'Checking git'
    Add-ToSessionPath (Join-Path $env:ProgramFiles 'Git\cmd')
    if (Test-GitWorks) {
        Write-Host "git is installed ($(& git --version))."
        return
    }
    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
        throw "git is not installed and winget is not available to install it.`nInstall git from https://git-scm.com/download/win, then run this again."
    }
    Write-Host 'Installing git for Windows. Windows may ask for permission; choose Yes.'
    & winget install --id Git.Git -e --source winget --silent --accept-package-agreements --accept-source-agreements
    Add-ToSessionPath (Join-Path $env:ProgramFiles 'Git\cmd')
    if (-not (Test-GitWorks)) {
        throw "git did not install.`nInstall git from https://git-scm.com/download/win, then run this again."
    }
}

# ------------------------------------------------------------- code and config

function Get-HiringHelperCode([string]$InstallDir) {
    Write-Step 'Getting Hiring Helper'
    if (Test-Path (Join-Path $InstallDir '.git')) {
        Write-Host "Found an existing install in $InstallDir. Updating it."
        & git -C $InstallDir pull --ff-only
        if ($LASTEXITCODE -ne 0) {
            throw "Could not update the existing install. If you changed files in $InstallDir, undo those changes and run this again."
        }
        return
    }
    if ((Test-Path $InstallDir) -and (Get-ChildItem $InstallDir -Force | Select-Object -First 1)) {
        throw "$InstallDir already exists and is not a Hiring Helper install. Pick another folder (set HH_DIR)."
    }
    New-Item -ItemType Directory -Force -Path (Split-Path $InstallDir -Parent) | Out-Null
    & git clone --depth 1 --branch $Branch $RepoUrl $InstallDir
    if ($LASTEXITCODE -ne 0) {
        throw "Could not download Hiring Helper from $RepoUrl (branch $Branch). Check your internet connection."
    }
}

function Set-AppPort([string]$InstallDir, [int]$Port) {
    $envPath = Join-Path $InstallDir '.env'
    if (-not (Test-Path $envPath)) { Copy-Item (Join-Path $InstallDir '.env.example') $envPath }

    $found = $false
    $lines = @(Get-Content $envPath | ForEach-Object {
            if ($_ -match '^PORT=') { $found = $true; "PORT=$Port" } else { $_ }
        })
    if (-not $found) { $lines += "PORT=$Port" }
    [IO.File]::WriteAllLines($envPath, [string[]]$lines, (New-Object Text.UTF8Encoding $false))
}

# -------------------------------------------------------------------- PATH

function Add-CommandToPath([string]$InstallDir) {
    $binDir = Join-Path $InstallDir 'bin'
    $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    $entries = @()
    if ($userPath) { $entries = @($userPath -split ';' | Where-Object { $_ }) }
    if ($entries -notcontains $binDir) {
        [Environment]::SetEnvironmentVariable('Path', (($entries + $binDir) -join ';'), 'User')
    }
    Add-ToSessionPath $binDir
    Write-Host 'Added the hiring-helper command to your PATH. Open a new terminal to use it.'
}

# -------------------------------------------------------------------- main

function Install-HiringHelper {
    Write-Host ''
    Write-Host 'Hiring Helper installer' -ForegroundColor Green
    if (-not (Test-CanAsk)) { Write-Host '(No keyboard questions, so every default is used.)' }

    # Questions first, so everything after them runs without waiting for you.
    $installDir = $env:HH_DIR
    if (-not $installDir) { $installDir = Read-Answer 'Install folder' (Join-Path $env:LOCALAPPDATA 'HiringHelper') }
    $installDir = [Environment]::ExpandEnvironmentVariables($installDir)

    $port = 0
    if ($env:HH_PORT) {
        if (-not (Test-ValidPort $env:HH_PORT)) { throw "HH_PORT must be a number from 1024 to 65535 (got `"$($env:HH_PORT)`")." }
        $port = [int]$env:HH_PORT
    }
    else {
        $existingPort = Get-ExistingPort $installDir
        $suggested = if ($existingPort) { $existingPort } else { "$DefaultPort" }
        while ($true) {
            $answer = Read-Answer 'Port for the app (an uncommon one avoids clashes with other tools)' $suggested
            if (-not (Test-ValidPort $answer)) {
                Write-Host 'Please enter a number from 1024 to 65535.'
                if (-not (Test-CanAsk)) { throw 'Invalid port.' }
                continue
            }
            if ((Test-PortInUse ([int]$answer)) -and ($answer -ne $existingPort)) {
                Write-Host "Something is already using port $answer."
                if (-not (Test-CanAsk)) { $port = [int]$answer; break }
                continue
            }
            $port = [int]$answer
            break
        }
    }

    $addToPath = (-not $env:HH_NO_PATH) -and (Confirm-Yes 'Add the hiring-helper command to your PATH?')
    $startNow = (-not $env:HH_NO_START) -and (Confirm-Yes 'Start Hiring Helper when the install finishes?')

    Install-GitIfMissing
    Get-HiringHelperCode $installDir
    Set-AppPort $installDir $port
    if ($addToPath) { Add-CommandToPath $installDir }

    Write-Step "Installed in $installDir (port $port)"
    $command = Join-Path $installDir 'bin\hiring-helper.cmd'
    if ($startNow) {
        if ($env:HH_NO_BROWSER) { & $command start --no-open } else { & $command start }
        if ($LASTEXITCODE -ne 0) { throw 'Hiring Helper did not start. The messages above say why.' }
    }
    else {
        Write-Host "Start it any time with: `"$command`" start"
    }

    Write-Host ''
    Write-Host 'Everyday commands (in a new terminal):'
    Write-Host '  hiring-helper start      start it and open the browser'
    Write-Host '  hiring-helper stop       stop it'
    Write-Host '  hiring-helper status     is it running?'
    Write-Host '  hiring-helper update     download the latest version'
}

try {
    Install-HiringHelper
}
catch {
    Write-Host ''
    Write-Host "Problem: $($_.Exception.Message)" -ForegroundColor Red
    # exit would close a window the person opened just to paste the command.
    $global:LASTEXITCODE = 1
}
