<#
.SYNOPSIS
    Installs dependencies when needed and starts Story Workspace locally.

.DESCRIPTION
    The script is intentionally foreground-only: npm and the Next.js server run
    in this PowerShell process tree and can be stopped with Ctrl+C.
#>
[CmdletBinding()]
param(
    [int]$Port = 3000,
    [string]$DatabasePath = '.data\story-workspace.db',
    [switch]$Production,
    [switch]$SkipInstall
)

$ErrorActionPreference = 'Stop'

$scriptRoot = $PSScriptRoot
$originalLocation = Get-Location
$exitCode = 0
$databasePathChanged = $false
$databaseEnvironmentVariableWasPresent = Test-Path -LiteralPath 'Env:STORY_WORKSPACE_DB_PATH'
$previousDatabasePath = $env:STORY_WORKSPACE_DB_PATH
$npmExecutable = $null

function Resolve-Executable {
    param(
        [Parameter(Mandatory = $true)]
        [string[]]$Names
    )

    foreach ($name in $Names) {
        $command = Get-Command -Name $name -ErrorAction SilentlyContinue |
            Where-Object { $_.CommandType -eq 'Application' -or $_.CommandType -eq 'ExternalScript' } |
            Select-Object -First 1

        if ($null -ne $command) {
            if (-not [string]::IsNullOrWhiteSpace([string]$command.Path)) {
                return [string]$command.Path
            }

            return [string]$command.Name
        }
    }

    return $null
}

function Test-PortAvailable {
    param(
        [Parameter(Mandatory = $true)]
        [int]$CandidatePort
    )

    $listener = $null
    try {
        # Any catches listeners already bound to localhost or to all IPv4
        # interfaces, which is how the Next.js dev/start server is launched.
        $listener = New-Object -TypeName System.Net.Sockets.TcpListener -ArgumentList @([System.Net.IPAddress]::Any, $CandidatePort)
        $listener.Start()
        return $true
    }
    catch {
        return $false
    }
    finally {
        if ($null -ne $listener) {
            $listener.Stop()
        }
    }
}

function Resolve-DatabasePath {
    param(
        [Parameter(Mandatory = $true)]
        [string]$PathValue
    )

    if ([string]::IsNullOrWhiteSpace($PathValue)) {
        throw 'DatabasePath must name a SQLite file.'
    }

    $lastCharacter = $PathValue.Substring($PathValue.Length - 1, 1)
    if ($lastCharacter -eq '\' -or $lastCharacter -eq '/') {
        throw ("DatabasePath must name a file, not a directory: '{0}'." -f $PathValue)
    }

    try {
        if ([System.IO.Path]::IsPathRooted($PathValue)) {
            $fullPath = [System.IO.Path]::GetFullPath($PathValue)
        }
        else {
            $fullPath = [System.IO.Path]::GetFullPath((Join-Path -Path $script:scriptRoot -ChildPath $PathValue))
        }
    }
    catch {
        throw ("DatabasePath is not a valid path: '{0}'." -f $PathValue)
    }

    if ([System.IO.Directory]::Exists($fullPath)) {
        throw ("DatabasePath points to a directory, not a SQLite file: '{0}'." -f $fullPath)
    }

    $parentPath = [System.IO.Path]::GetDirectoryName($fullPath)
    if ([string]::IsNullOrWhiteSpace($parentPath)) {
        throw ("Could not determine the parent directory for DatabasePath '{0}'." -f $fullPath)
    }

    if ([System.IO.File]::Exists($parentPath)) {
        throw ("The database parent path is a file, not a directory: '{0}'." -f $parentPath)
    }

    if (-not [System.IO.Directory]::Exists($parentPath)) {
        try {
            [System.IO.Directory]::CreateDirectory($parentPath) | Out-Null
        }
        catch {
            throw ("Could not create the database parent directory '{0}': {1}" -f $parentPath, $_.Exception.Message)
        }
    }

    return $fullPath
}

function Invoke-Npm {
    param(
        [Parameter(Mandatory = $true)]
        [string[]]$Arguments,
        [Parameter(Mandatory = $true)]
        [string]$Step
    )

    Write-Host ("[start-local] Running npm {0}." -f ($Arguments -join ' '))
    & $script:npmExecutable @Arguments
    $commandExitCode = $LASTEXITCODE
    if ($commandExitCode -ne 0) {
        throw ("npm {0} failed with exit code {1}." -f $Step, $commandExitCode)
    }
}

try {
    if ([string]::IsNullOrWhiteSpace($scriptRoot)) {
        throw 'Could not determine the directory containing start-local.ps1.'
    }

    Set-Location -LiteralPath $scriptRoot

    if ($Port -lt 1 -or $Port -gt 65535) {
        throw ("Port must be between 1 and 65535; received {0}." -f $Port)
    }

    $packagePath = Join-Path -Path $scriptRoot -ChildPath 'package.json'
    if (-not (Test-Path -LiteralPath $packagePath -PathType Leaf)) {
        throw ("package.json was not found in '{0}'. Run this script from a project checkout." -f $scriptRoot)
    }

    try {
        $packageJson = Get-Content -LiteralPath $packagePath -Raw | ConvertFrom-Json
    }
    catch {
        throw ("Could not read package.json: {0}" -f $_.Exception.Message)
    }

    $nodeEngine = [string]$packageJson.engines.node
    if ($nodeEngine -notmatch '^\s*>=\s*24(?:\.0(?:\.0)?)?\s+<\s*25(?:\.0(?:\.0)?)?\s*$') {
        throw ("package.json engines.node must be >=24 <25; found '{0}'." -f $nodeEngine)
    }

    $nodeExecutable = Resolve-Executable -Names @('node.exe', 'node')
    if ([string]::IsNullOrWhiteSpace($nodeExecutable)) {
        throw 'Node.js was not found on PATH. Install Node.js 24.x and try again.'
    }

    $nodeVersionOutput = (& $nodeExecutable --version 2>&1 | Out-String).Trim()
    $nodeVersionExitCode = $LASTEXITCODE
    if ($nodeVersionExitCode -ne 0) {
        throw ("Could not run Node.js from '{0}'." -f $nodeExecutable)
    }

    $nodeVersionMatch = [regex]::Match($nodeVersionOutput, '^\s*v?([0-9]+)(?:\.[0-9]+){0,2}')
    if (-not $nodeVersionMatch.Success) {
        throw ("Could not determine the Node.js version from '{0}'." -f $nodeVersionOutput)
    }

    $nodeMajor = [int]$nodeVersionMatch.Groups[1].Value
    if ($nodeMajor -ne 24) {
        throw ("Node.js 24.x is required by package.json (engines.node {0}); found {1}." -f $nodeEngine, $nodeVersionOutput)
    }

    $npmExecutable = Resolve-Executable -Names @('npm.cmd', 'npm.exe', 'npm')
    if ([string]::IsNullOrWhiteSpace($npmExecutable)) {
        throw 'npm was not found on PATH. Install npm with Node.js 24.x and try again.'
    }

    $npmVersionOutput = (& $npmExecutable --version 2>&1 | Out-String).Trim()
    $npmVersionExitCode = $LASTEXITCODE
    if ($npmVersionExitCode -ne 0) {
        throw ("Could not run npm from '{0}'." -f $npmExecutable)
    }

    if (-not (Test-PortAvailable -CandidatePort $Port)) {
        throw ("Port {0} is unavailable or already in use. Stop the other process or choose another port with -Port." -f $Port)
    }

    $resolvedDatabasePath = Resolve-DatabasePath -PathValue $DatabasePath

    $nodeModulesPath = Join-Path -Path $scriptRoot -ChildPath 'node_modules'
    if (-not (Test-Path -LiteralPath $nodeModulesPath -PathType Container)) {
        if ($SkipInstall) {
            throw "node_modules is missing and -SkipInstall was supplied. Install dependencies first or omit -SkipInstall."
        }

        $lockfilePath = Join-Path -Path $scriptRoot -ChildPath 'package-lock.json'
        if (Test-Path -LiteralPath $lockfilePath -PathType Leaf) {
            Invoke-Npm -Arguments @('ci') -Step 'ci'
        }
        else {
            Invoke-Npm -Arguments @('install') -Step 'install'
        }
    }

    $env:STORY_WORKSPACE_DB_PATH = $resolvedDatabasePath
    $databasePathChanged = $true

    $mode = 'development'
    if ($Production) {
        $mode = 'production'
    }

    Write-Host ("[start-local] Starting {0} server on port {1}." -f $mode, $Port)
    Write-Host ("[start-local] SQLite database: {0}" -f $resolvedDatabasePath)
    Write-Host '[start-local] Press Ctrl+C to stop the foreground server.'

    if ($Production) {
        Invoke-Npm -Arguments @('run', 'build') -Step 'run build'
        Invoke-Npm -Arguments @('run', 'start', '--', '-p', [string]$Port) -Step 'run start'
    }
    else {
        Invoke-Npm -Arguments @('run', 'dev', '--', '-p', [string]$Port) -Step 'run dev'
    }
}
catch {
    $message = $_.Exception.Message
    if ([string]::IsNullOrWhiteSpace($message)) {
        $message = 'The local server could not be started.'
    }

    [Console]::Error.WriteLine(("[start-local] {0}" -f $message))
    $exitCode = 1
}
finally {
    if ($databasePathChanged) {
        if ($databaseEnvironmentVariableWasPresent) {
            $env:STORY_WORKSPACE_DB_PATH = $previousDatabasePath
        }
        else {
            Remove-Item -LiteralPath 'Env:STORY_WORKSPACE_DB_PATH' -ErrorAction SilentlyContinue
        }
    }

    if ($null -ne $originalLocation) {
        try {
            Set-Location -LiteralPath $originalLocation.Path -ErrorAction Stop
        }
        catch {
            Write-Warning ("[start-local] Could not restore the original PowerShell location: {0}" -f $_.Exception.Message)
        }
    }
}

if ($exitCode -ne 0) {
    exit $exitCode
}
