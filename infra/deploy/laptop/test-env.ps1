<#
  TEST environment on this Windows PC: runs infra/deploy/laptop/laptop.sh inside WSL and keeps WSL awake.
  WSL shuts an idle distro down after a while, which stops Docker and the whole test stack.

    .\test-env.ps1 deploy             build from this checkout and deploy (also starts the keep-alive)
    .\test-env.ps1 start              keep WSL running (Docker restarts the stack by itself)
    .\test-env.ps1 stop               stop the keep-alive (WSL may then stop the stack when idle)
    .\test-env.ps1 autostart          start the keep-alive at every Windows sign-in (no admin needed)
    .\test-env.ps1 status | logs api | bootstrap | migrate | ...   any santha.sh command

  -Distro selects the WSL distro (default Ubuntu-24.04). Guide: docs/deploy/README.md.
#>
param(
  [Parameter(Position = 0)] [string] $Command = 'help',
  [string] $Distro = 'Ubuntu-24.04',
  [Parameter(ValueFromRemainingArguments = $true)] [string[]] $Rest = @()
)
$ErrorActionPreference = 'Stop'

function Get-KeepAlive {
  Get-CimInstance Win32_Process -Filter "Name = 'wsl.exe'" |
    Where-Object { $_.CommandLine -like "*-d $Distro *-- sleep infinity*" }
}

function Start-KeepAlive {
  if (Get-KeepAlive) { Write-Output "Keep-alive already running for $Distro."; return }
  # A Windows-side wsl.exe that never exits keeps the distro (and Docker inside it) running.
  Start-Process wsl.exe -WindowStyle Hidden -ArgumentList @('-d', $Distro, '-u', 'root', '--', 'sleep', 'infinity')
  Write-Output "Keep-alive started for $Distro. The test stack keeps running while you are signed in and the PC is awake."
}

function Get-LinuxPath([string] $winPath) {
  $p = (Resolve-Path $winPath).Path
  '/mnt/' + $p.Substring(0, 1).ToLower() + ($p.Substring(2) -replace '\\', '/')
}

$script = Get-LinuxPath (Join-Path $PSScriptRoot 'laptop.sh')

switch ($Command) {
  'start' { Start-KeepAlive }
  'stop' {
    Get-KeepAlive | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
    Write-Output 'Keep-alive stopped. WSL may now shut down when idle, which stops the test stack.'
  }
  'autostart' {
    $startup = [Environment]::GetFolderPath('Startup')
    $lnk = Join-Path $startup 'Santha test environment.lnk'
    $shell = New-Object -ComObject WScript.Shell
    $s = $shell.CreateShortcut($lnk)
    $s.TargetPath = (Get-Command powershell.exe).Source
    $s.Arguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$PSCommandPath`" start -Distro $Distro"
    $s.WindowStyle = 7
    $s.Save()
    Write-Output "Added '$lnk'. Delete that file to turn autostart off."
    Start-KeepAlive
  }
  { $_ -in 'help', '-h', '--help' } { Get-Content $PSCommandPath -TotalCount 11 | Select-Object -Skip 1 | Write-Output }
  default {
    Start-KeepAlive
    & wsl.exe -d $Distro -u root -- bash $script $Command @Rest
    exit $LASTEXITCODE
  }
}
