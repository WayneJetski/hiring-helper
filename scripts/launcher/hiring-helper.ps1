# hiring-helper: start, stop and manage Hiring Helper (Windows).
#
#   hiring-helper start [--foreground] [--no-open]   start it and open the browser
#   hiring-helper stop                               stop it
#   hiring-helper restart [--no-open]                stop, then start
#   hiring-helper status                             is it running, and where
#   hiring-helper open                               open it in the browser
#   hiring-helper logs [-f]                          show (or follow) the log
#   hiring-helper update [--check]                   download the latest version (or just look)
#
# Reached through bin\hiring-helper.cmd. Keep this file ASCII-only: Windows
# PowerShell 5.1 misreads UTF-8 without a BOM.

$ErrorActionPreference = 'Stop'

# Defines the setup functions and paths (RepoRoot, RuntimeDir) without running the launcher.
. (Join-Path $PSScriptRoot 'start.ps1')

$PidFile = Join-Path $RuntimeDir 'server.pid'
$LogFile = Join-Path $RuntimeDir 'server.log'
$ErrorLogFile = Join-Path $RuntimeDir 'server.err.log'
$ServerJs = Join-Path $RepoRoot 'server\dist\index.js'

function Get-ServerUrl { return "http://localhost:$(Get-ServerPort)" }

function Open-Browser { Start-Process (Get-ServerUrl) }

# The server process this command started, but only if it really is ours (ids get reused).
function Get-OurServerProcess {
    if (-not (Test-Path $PidFile)) { return $null }
    $processId = [int](Get-Content $PidFile -ErrorAction SilentlyContinue | Select-Object -First 1)
    if (-not $processId) { return $null }
    $details = Get-CimInstance Win32_Process -Filter "ProcessId = $processId" -ErrorAction SilentlyContinue
    if ($null -eq $details -or $details.CommandLine -notlike '*server\dist\index.js*') { return $null }
    return Get-Process -Id $processId -ErrorAction SilentlyContinue
}

function Wait-UntilHealthy($ServerProcess) {
    $port = Get-ServerPort
    for ($attempt = 0; $attempt -lt 90; $attempt++) {
        if (Test-ServerIsRunning $port) { return $true }
        if ($null -ne $ServerProcess -and $ServerProcess.HasExited) { return $false }
        Start-Sleep -Seconds 1
    }
    return $false
}

function Invoke-Setup {
    Initialize-Node
    Initialize-Git
    Initialize-ClaudeCode
    Initialize-AppFiles
}

# Runs git in the install folder; never prompts for a password, never throws on a non-zero exit.
function Invoke-Git([string[]]$Arguments) {
    $previousPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $env:GIT_TERMINAL_PROMPT = '0'
    try {
        $output = & git -C $RepoRoot @Arguments 2>&1 | ForEach-Object { "$_" }
        return [pscustomobject]@{ Ok = ($LASTEXITCODE -eq 0); Output = ($output -join "`n").Trim() }
    }
    finally {
        $ErrorActionPreference = $previousPreference
    }
}

function Stop-HiringHelper {
    $serverProcess = Get-OurServerProcess
    if ($null -eq $serverProcess) {
        if (Test-ServerIsRunning (Get-ServerPort)) {
            throw "Something is answering on port $(Get-ServerPort), but it was not started by hiring-helper, so it was left alone."
        }
        Remove-Item $PidFile -ErrorAction SilentlyContinue
        Write-Host 'Hiring Helper is not running.'
        return
    }
    Stop-Process -Id $serverProcess.Id -Force
    $null = $serverProcess.WaitForExit(15000)
    Remove-Item $PidFile -ErrorAction SilentlyContinue
    Write-Host 'Hiring Helper stopped.'
}

function Start-HiringHelperService([string[]]$Options, [switch]$SkipSetup) {
    $foreground = $Options -contains '--foreground'
    $noOpen = ($Options -contains '--no-open') -or ($env:HH_NO_BROWSER -eq '1')
    $port = Get-ServerPort

    if (($null -ne (Get-OurServerProcess)) -and (Test-ServerIsRunning $port)) {
        Write-Host "Hiring Helper is already running at $(Get-ServerUrl)"
        if (-not $noOpen) { Open-Browser }
        return
    }
    if ($null -ne (Get-OurServerProcess)) { Stop-HiringHelper }   # a stale or stuck copy
    if (Test-ServerIsRunning $port) {
        throw "Something is already answering on port $port, and it was not started by hiring-helper. Stop it, or choose another port in $RepoRoot\.env."
    }

    Set-Location $RepoRoot
    if (-not $SkipSetup) { Invoke-Setup } else { Add-ToPath $LocalNodeDir }
    if (-not (Test-Path $ServerJs)) { throw 'The app is not built yet. Run: hiring-helper start' }

    $env:HIRING_HELPER_MANAGED = '1'

    if ($foreground) {
        Write-Host 'Keep this window open while you use the app. Close it to stop the app.' -ForegroundColor Yellow
        Start-HiringHelper
        return
    }

    $env:NODE_ENV = 'production'
    New-Item -ItemType Directory -Force -Path $RuntimeDir | Out-Null
    $nodePath = (Get-Command node).Source
    Write-Host ''
    Write-Host 'Starting Hiring Helper...'
    $serverProcess = Start-Process -FilePath $nodePath -ArgumentList @("`"$ServerJs`"") -WorkingDirectory $RepoRoot `
        -WindowStyle Hidden -RedirectStandardOutput $LogFile -RedirectStandardError $ErrorLogFile -PassThru
    Set-Content -Path $PidFile -Value $serverProcess.Id

    if (-not (Wait-UntilHealthy $serverProcess)) {
        Write-Host ''
        Write-Host "Hiring Helper did not start. The end of its log ($ErrorLogFile):" -ForegroundColor Red
        if (Test-Path $ErrorLogFile) { Get-Content $ErrorLogFile -Tail 20 }
        Remove-Item $PidFile -ErrorAction SilentlyContinue
        exit 1
    }
    Write-Host "Hiring Helper is running at $(Get-ServerUrl)"
    Write-Host 'Stop it with: hiring-helper stop'
    if (-not $noOpen) { Open-Browser }
}

function Restart-HiringHelper([string[]]$Options) {
    # Set up first: if that fails, the running copy is left alone.
    Invoke-Setup
    if ($null -ne (Get-OurServerProcess)) { Stop-HiringHelper }
    Start-HiringHelperService $Options -SkipSetup
}

function Show-Status {
    $serverProcess = Get-OurServerProcess
    if (($null -ne $serverProcess) -and (Test-ServerIsRunning (Get-ServerPort))) {
        Write-Host "Hiring Helper is running at $(Get-ServerUrl) (process $($serverProcess.Id))"
    }
    elseif ($null -ne $serverProcess) {
        Write-Host "Hiring Helper is starting or not responding (process $($serverProcess.Id)). Check: hiring-helper logs"
        exit 1
    }
    else {
        Write-Host 'Hiring Helper is not running. Start it with: hiring-helper start'
        exit 1
    }
}

function Show-Logs([string[]]$Options) {
    if (-not (Test-Path $ErrorLogFile) -and -not (Test-Path $LogFile)) {
        throw 'There is no log yet. Start it with: hiring-helper start'
    }
    $follow = $Options -contains '-f'
    foreach ($path in @($LogFile, $ErrorLogFile)) {
        if (-not (Test-Path $path)) { continue }
        Write-Host "--- $path"
        if ($follow) { Get-Content $path -Tail 50 -Wait } else { Get-Content $path -Tail 50 }
    }
}

# Is there a newer version on the branch this copy follows? Asks the remote for the
# branch's tip (nothing is downloaded) and checks whether this copy already has it.
function Show-UpdateCheck {
    $branch = (Invoke-Git @('rev-parse', '--abbrev-ref', 'HEAD')).Output
    if ($branch -eq 'HEAD' -or $branch -eq '') { throw 'This copy is not on a branch, so it cannot check for updates.' }
    $localSha = (Invoke-Git @('rev-parse', 'HEAD')).Output
    $remote = Invoke-Git @('ls-remote', 'origin', "refs/heads/$branch")
    if (-not $remote.Ok) { throw 'Could not reach the update server to check for updates.' }
    $remoteSha = ($remote.Output -split '\s+' | Select-Object -First 1)
    if (-not $remoteSha) { throw "The update server has no `"$branch`" branch." }

    $isRemoteIncluded = (Invoke-Git @('merge-base', '--is-ancestor', $remoteSha, 'HEAD')).Ok
    if (($remoteSha -ne $localSha) -and (-not $isRemoteIncluded)) {
        Write-Host "An update is available ($($localSha.Substring(0, 7)) -> $($remoteSha.Substring(0, 7))). Install it with: hiring-helper update"
    }
    else {
        Write-Host "You have the latest version ($($localSha.Substring(0, 7)))."
    }
}

function Update-HiringHelper([string[]]$Options) {
    if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw 'git is needed to update.' }
    if (-not (Test-Path (Join-Path $RepoRoot '.git'))) { throw 'This copy was not installed with git, so it cannot update itself.' }
    if ($Options -contains '--check') { Show-UpdateCheck; return }

    $wasRunning = $null -ne (Get-OurServerProcess)
    Write-Host 'Downloading the latest version...'
    # npm can rewrite package-lock.json by itself. If that is the only change, put the file
    # back so the pull is clean; any other change is the person's and is left alone.
    $changed = (Invoke-Git @('status', '--porcelain', '--untracked-files=no')).Output
    if ($changed.Trim() -eq 'M package-lock.json') { $null = Invoke-Git @('checkout', '--', 'package-lock.json') }
    $pull = Invoke-Git @('pull', '--ff-only')
    if (-not $pull.Ok) {
        throw "The update could not be downloaded. If you changed files in $RepoRoot, undo those changes and try again. $($pull.Output)"
    }
    if ($wasRunning) {
        Write-Host 'Restarting with the new version...'
        Restart-HiringHelper @('--no-open')
    }
    else {
        Write-Host 'Updated. Start it with: hiring-helper start'
    }
}

function Show-Usage {
    Write-Host @'
Usage: hiring-helper <command>

  start [--foreground] [--no-open]   Start Hiring Helper and open it in your browser
  stop                               Stop it
  restart [--no-open]                Stop, then start
  status                             Show whether it is running, and where
  open                               Open it in your browser
  logs [-f]                          Show the log (-f keeps following it)
  update [--check]                   Download the latest version (and restart if it was running);
                                     --check only says whether one is available
'@
}

try {
    $command = if ($args.Count -gt 0) { [string]$args[0] } else { 'help' }
    $options = if ($args.Count -gt 1) { [string[]]$args[1..($args.Count - 1)] } else { @() }

    switch ($command) {
        'start' { Start-HiringHelperService $options }
        'stop' { Stop-HiringHelper }
        'restart' { Restart-HiringHelper $options }
        'status' { Show-Status }
        'open' {
            if (Test-ServerIsRunning (Get-ServerPort)) { Open-Browser }
            else { throw 'Hiring Helper is not running. Start it with: hiring-helper start' }
        }
        'logs' { Show-Logs $options }
        'update' { Update-HiringHelper $options }
        { $_ -in 'help', '-h', '--help' } { Show-Usage }
        default { Show-Usage; exit 1 }
    }
}
catch {
    Write-Host ''
    Write-Host "Problem: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
