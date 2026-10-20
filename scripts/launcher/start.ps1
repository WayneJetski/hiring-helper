# Hiring Helper launcher (Windows).
#
# Checks and installs what the app needs, builds it when needed, starts it, and
# opens it in the browser. Safe to run every time: each step is skipped when it
# is already done.
#
#   Node.js      downloaded into .runtime\node when missing (no admin rights)
#   Git          needed by Claude Code on Windows; installed with winget if missing
#   Claude Code  installed with Anthropic's official installer if missing
#   BambooHR     entered in the web app on first run (the app redirects to /setup)
#
# Keep this file ASCII-only: Windows PowerShell 5.1 misreads UTF-8 without a BOM.

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'   # progress bars make Invoke-WebRequest very slow in 5.1
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$RuntimeDir = Join-Path $RepoRoot '.runtime'
$LocalNodeDir = Join-Path $RuntimeDir 'node'
$ClaudeVerifiedStamp = Join-Path $RuntimeDir 'claude-verified.stamp'
$BuildStamp = Join-Path $RuntimeDir 'build.stamp'

# Node line to download when the machine has no suitable Node. Even-numbered
# (LTS) lines only: better-sqlite3 ships prebuilt binaries for them, so no C++
# compiler is needed.
$NodeDownloadLine = 'v22.x'
$MinimumNodeMajor = 20

function Write-Step([string]$Message) {
    Write-Host ''
    Write-Host "==> $Message" -ForegroundColor Cyan
}

function Add-ToPath([string]$Directory) {
    if (-not (Test-Path $Directory)) { return }
    $entries = $env:PATH -split ';'
    if ($entries -notcontains $Directory) {
        $env:PATH = "$Directory;$env:PATH"
    }
}

function Test-CommandExists([string]$Name) {
    return $null -ne (Get-Command $Name -ErrorAction SilentlyContinue)
}

# Runs a native command and throws if it exits non-zero.
function Invoke-Checked([string]$FilePath, [string[]]$Arguments, [string]$FailureMessage) {
    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$FailureMessage (exit code $LASTEXITCODE)."
    }
}

# ---------------------------------------------------------------- Node.js

function Get-NodeMajorVersion {
    if (-not (Test-CommandExists 'node')) { return 0 }
    $versionText = (& node --version) -replace '^v', ''
    return [int]($versionText.Split('.')[0])
}

function Test-NodeIsUsable {
    $major = Get-NodeMajorVersion
    return ($major -ge $MinimumNodeMajor) -and ($major % 2 -eq 0)
}

function Install-LocalNode {
    $architecture = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
    $platform = if ($architecture -eq 'ARM64') { 'win-arm64' } else { 'win-x64' }
    $baseUrl = "https://nodejs.org/dist/latest-$NodeDownloadLine"

    Write-Host "Downloading Node.js ($platform). This happens once and takes a minute or two..."
    $checksumText = (Invoke-WebRequest -UseBasicParsing "$baseUrl/SHASUMS256.txt").Content
    $checksumLine = $checksumText -split "`n" |
        ForEach-Object { $_.Trim() } |
        Where-Object { $_ -match "node-v[\d\.]+-$platform\.zip$" } |
        Select-Object -First 1
    if (-not $checksumLine) { throw "Could not find a Node.js download for $platform." }
    $expectedHash, $archiveName = $checksumLine -split '\s+'

    New-Item -ItemType Directory -Force -Path $RuntimeDir | Out-Null
    $archivePath = Join-Path $RuntimeDir $archiveName
    Invoke-WebRequest -UseBasicParsing "$baseUrl/$archiveName" -OutFile $archivePath

    $actualHash = (Get-FileHash -Algorithm SHA256 $archivePath).Hash
    if ($actualHash -ne $expectedHash.ToUpper()) {
        Remove-Item -Force $archivePath
        throw 'The downloaded Node.js file failed its checksum. Check your connection and try again.'
    }

    Write-Host 'Unpacking Node.js...'
    $extractDir = Join-Path $RuntimeDir 'node-extract'
    if (Test-Path $extractDir) { Remove-Item -Recurse -Force $extractDir }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [System.IO.Compression.ZipFile]::ExtractToDirectory($archivePath, $extractDir)

    if (Test-Path $LocalNodeDir) { Remove-Item -Recurse -Force $LocalNodeDir }
    $unpackedFolder = Get-ChildItem $extractDir -Directory | Select-Object -First 1
    Move-Item $unpackedFolder.FullName $LocalNodeDir
    Remove-Item -Recurse -Force $extractDir
    Remove-Item -Force $archivePath
}

function Initialize-Node {
    Write-Step 'Checking Node.js'
    # The copy next to the app wins, so a previous download keeps being used.
    Add-ToPath $LocalNodeDir
    if (-not (Test-NodeIsUsable)) {
        Install-LocalNode
        Add-ToPath $LocalNodeDir
    }
    if (-not (Test-NodeIsUsable)) {
        throw 'Node.js could not be set up.'
    }
    Write-Host "Node.js $(& node --version) is ready."
}

# ------------------------------------------------------------ Git (for Claude Code)

function Find-GitBash {
    $candidates = @(
        (Join-Path $env:ProgramFiles 'Git\bin\bash.exe'),
        (Join-Path ${env:ProgramFiles(x86)} 'Git\bin\bash.exe'),
        (Join-Path $env:LOCALAPPDATA 'Programs\Git\bin\bash.exe')
    )
    return $candidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
}

# Claude Code on Windows needs Git for Windows (it uses Git Bash internally).
function Initialize-Git {
    Write-Step 'Checking Git for Windows (required by Claude Code)'
    $bashPath = Find-GitBash
    if (-not $bashPath) {
        if (-not (Test-CommandExists 'winget')) {
            throw "Git for Windows is not installed and winget is not available to install it.`nInstall it from https://git-scm.com/download/win, then double-click start.bat again."
        }
        Write-Host 'Installing Git for Windows. Windows may ask for permission; choose Yes.'
        & winget install --id Git.Git -e --source winget --silent --accept-package-agreements --accept-source-agreements
        $bashPath = Find-GitBash
        if (-not $bashPath) {
            throw "Git for Windows did not install.`nInstall it from https://git-scm.com/download/win, then double-click start.bat again."
        }
    }
    $env:CLAUDE_CODE_GIT_BASH_PATH = $bashPath
    Write-Host 'Git for Windows is ready.'
}

# ------------------------------------------------------------------ Claude Code

function Initialize-ClaudeCode {
    if ($env:HH_SKIP_CLAUDE -eq '1') {
        Write-Step 'Skipping Claude Code (HH_SKIP_CLAUDE is set)'
        return
    }
    Write-Step 'Checking Claude Code (used to score candidates)'
    Add-ToPath (Join-Path $env:USERPROFILE '.local\bin')

    if (-not (Test-CommandExists 'claude')) {
        Write-Host 'Installing Claude Code with the official installer...'
        # Child process: the installer script may call exit, which must not end this script.
        & powershell -NoProfile -ExecutionPolicy Bypass -Command 'irm https://claude.ai/install.ps1 | iex'
        Add-ToPath (Join-Path $env:USERPROFILE '.local\bin')
        if (-not (Test-CommandExists 'claude')) {
            throw "Claude Code did not install.`nSee https://docs.claude.com/en/docs/claude-code/overview, install it, then double-click start.bat again."
        }
    }
    Write-Host "Claude Code is installed ($(& claude --version))."

    if (Test-Path $ClaudeVerifiedStamp) { return }

    Write-Host 'Checking that Claude Code is signed in...'
    if (-not (Test-ClaudeSignedIn)) {
        Write-Host ''
        Write-Host 'Claude Code needs you to sign in once.' -ForegroundColor Yellow
        Write-Host 'It will open now. Follow the prompts to sign in with your Claude account.'
        Write-Host 'When it says you are logged in, type /exit and press Enter to continue.'
        Write-Host ''
        Invoke-InNeutralDirectory { & claude }
        if (-not (Test-ClaudeSignedIn)) {
            Write-Host 'Claude Code is still not signed in. The app will open, but scoring will not work' -ForegroundColor Yellow
            Write-Host 'until you sign in. Run start.bat again to retry.' -ForegroundColor Yellow
            return
        }
    }
    New-Item -ItemType Directory -Force -Path $RuntimeDir | Out-Null
    Set-Content -Path $ClaudeVerifiedStamp -Value (Get-Date -Format o)
}

# Runs from the temp folder so Claude Code does not try to start this project's
# scoring server (its packages may not be installed yet) during sign-in.
function Invoke-InNeutralDirectory([scriptblock]$Action) {
    Push-Location $env:TEMP
    try { & $Action }
    finally { Pop-Location }
}

# A one-word prompt: proves the login works and costs a trivial amount.
function Test-ClaudeSignedIn {
    $previousPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'   # native stderr must not throw in Windows PowerShell 5.1
    try {
        Invoke-InNeutralDirectory { $null = & claude -p 'Reply with the single word OK' 2>&1 }
        return ($LASTEXITCODE -eq 0)
    }
    finally {
        $ErrorActionPreference = $previousPreference
    }
}

# ------------------------------------------------------------- App install and build

function Initialize-AppFiles {
    Write-Step 'Checking app files'
    # Building needs the development packages. A restart started by the running server
    # would otherwise pass NODE_ENV=production on to npm.
    Remove-Item Env:\NODE_ENV -ErrorAction SilentlyContinue
    $envPath = Join-Path $RepoRoot '.env'
    if (-not (Test-Path $envPath)) {
        Copy-Item (Join-Path $RepoRoot '.env.example') $envPath
    }

    $installedMarker = Join-Path $RepoRoot 'node_modules\.package-lock.json'
    $lockFile = Join-Path $RepoRoot 'package-lock.json'
    $needsInstall = (-not (Test-Path $installedMarker)) -or
        ((Get-Item $lockFile).LastWriteTime -gt (Get-Item $installedMarker).LastWriteTime)
    if ($needsInstall) {
        Write-Host 'Installing app packages (first run takes a few minutes)...'
        Invoke-Checked 'npm' @('ci', '--include=dev', '--no-audit', '--no-fund') 'Installing the app packages failed'
    }

    $builtOutputs = @(
        (Join-Path $RepoRoot 'client\dist\index.html'),
        (Join-Path $RepoRoot 'server\dist\index.js')
    )
    $isBuilt = ($builtOutputs | Where-Object { -not (Test-Path $_) }).Count -eq 0
    $hasNewerSource = $false
    if ($isBuilt -and (Test-Path $BuildStamp)) {
        $stampTime = (Get-Item $BuildStamp).LastWriteTime
        $newerSource = Get-ChildItem (Join-Path $RepoRoot 'client\src'), (Join-Path $RepoRoot 'server\src') -Recurse -File |
            Where-Object { $_.LastWriteTime -gt $stampTime } |
            Select-Object -First 1
        $hasNewerSource = $null -ne $newerSource
    }
    if ((-not $isBuilt) -or (-not (Test-Path $BuildStamp)) -or $hasNewerSource) {
        Write-Host 'Building the app (first run takes a minute)...'
        Invoke-Checked 'npm' @('run', 'build') 'Building the app failed'
        New-Item -ItemType Directory -Force -Path $RuntimeDir | Out-Null
        Set-Content -Path $BuildStamp -Value (Get-Date -Format o)
    }
}

# ------------------------------------------------------------------------- Run

function Get-ServerPort {
    if ($env:PORT) { return [int]$env:PORT }
    $envPath = Join-Path $RepoRoot '.env'
    $portLine = Get-Content $envPath -ErrorAction SilentlyContinue | Where-Object { $_ -match '^\s*PORT\s*=\s*(\d+)' } | Select-Object -First 1
    if ($portLine -match '(\d+)') { return [int]$Matches[1] }
    return 3000
}

function Test-ServerIsRunning([int]$Port) {
    try {
        $null = Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:$Port/health" -TimeoutSec 2
        return $true
    }
    catch {
        return $false
    }
}

function Start-HiringHelper {
    $port = Get-ServerPort
    $address = "http://localhost:$port"

    if (Test-ServerIsRunning $port) {
        Write-Host "Hiring Helper is already running. Opening $address"
        Start-Process $address
        return
    }

    Write-Step 'Starting Hiring Helper'
    Write-Host "Opening $address in your browser as soon as it is ready."
    Write-Host 'Keep this window open while you use the app. Close it to stop the app.' -ForegroundColor Yellow

    # Waits in the background for the server, then opens the browser once.
    $browserJob = Start-Job -ArgumentList $port, $address -ScriptBlock {
        param($jobPort, $jobAddress)
        for ($attempt = 0; $attempt -lt 120; $attempt++) {
            try {
                $null = Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:$jobPort/health" -TimeoutSec 2
                Start-Process $jobAddress
                return
            }
            catch {
                Start-Sleep -Seconds 1
            }
        }
    }

    # NODE_ENV is set here (dotenv does not override it) so errors do not expose stack traces.
    $env:NODE_ENV = 'production'
    try {
        & node (Join-Path $RepoRoot 'server\dist\index.js')
    }
    finally {
        Remove-Job -Job $browserJob -Force
    }
    if ($LASTEXITCODE -ne 0) {
        throw "Hiring Helper stopped unexpectedly (exit code $LASTEXITCODE). The messages above say why."
    }
}

# Dot-sourcing this file (as hiring-helper.ps1 does) defines the functions above
# without running the launcher.
if ($MyInvocation.InvocationName -ne '.') {
    try {
        Set-Location $RepoRoot
        Write-Host 'Hiring Helper' -ForegroundColor Green
        Initialize-Node
        Initialize-Git
        Initialize-ClaudeCode
        Initialize-AppFiles
        Start-HiringHelper
    }
    catch {
        Write-Host ''
        Write-Host "Problem: $($_.Exception.Message)" -ForegroundColor Red
        exit 1
    }
}
