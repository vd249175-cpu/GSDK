param(
  [ValidateSet('List','Select','Start','Mcp')][string]$Action = 'Start',
  [string]$Profile,
  [string]$RuntimeDir
)
$ErrorActionPreference = 'Stop'

# Project-level browser runtime path (.agents/browser)
$agentsRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$runtime = if ($RuntimeDir) { $RuntimeDir } else { Join-Path $agentsRoot 'browser' }
if (!(Test-Path -LiteralPath $runtime)) {
  New-Item -ItemType Directory -Force $runtime | Out-Null
}

$configPath = Join-Path $runtime 'selection.json'
$sourceRoot = Join-Path $env:LOCALAPPDATA 'Google\Chrome\User Data'
$port = 9343

# Auto-inherit from existing .pi profile data if available and not yet initialized in project
$piBrowserDir = Join-Path $env:USERPROFILE '.pi\agent\browser'
if (Test-Path -LiteralPath $piBrowserDir) {
  if (!(Test-Path -LiteralPath $configPath) -and (Test-Path -LiteralPath (Join-Path $piBrowserDir 'selection.json'))) {
    Copy-Item -LiteralPath (Join-Path $piBrowserDir 'selection.json') -Destination $configPath -Force
  }
  Get-ChildItem -Path $piBrowserDir -Directory -Filter "data-*" | ForEach-Object {
    $targetDataDir = Join-Path $runtime $_.Name
    if (!(Test-Path -LiteralPath $targetDataDir)) {
      cmd /c mklink /J "$targetDataDir" "$($_.FullName)" | Out-Null
    }
  }
  $piPptr = Join-Path $piBrowserDir 'puppeteer-tools'
  $targetPptr = Join-Path $runtime 'puppeteer-tools'
  if ((Test-Path -LiteralPath $piPptr) -and !(Test-Path -LiteralPath $targetPptr)) {
    cmd /c mklink /J "$targetPptr" "$piPptr" | Out-Null
  }
}

function Get-Profiles {
  $statePath = Join-Path $sourceRoot 'Local State'
  if (Test-Path -LiteralPath $statePath) {
    $state = Get-Content -Raw -LiteralPath $statePath | ConvertFrom-Json
    foreach ($entry in $state.profile.info_cache.PSObject.Properties) {
      [pscustomobject]@{ directory=$entry.Name; name=$entry.Value.name }
    }
  }
}

$profiles = @(Get-Profiles)
if ($Action -eq 'List') {
  ConvertTo-Json -InputObject $profiles
  exit 0
}

if ($Action -eq 'Select') {
  if ($Profile -ne 'New' -and $Profile -notin $profiles.directory) {
    throw 'Choose an exact directory from -Action List, or New for a new account.'
  }
  New-Item -ItemType Directory -Force $runtime | Out-Null
  $label = if ($Profile -eq 'New') { 'New account' } else { ($profiles | Where-Object directory -eq $Profile).name }
  @{directory=$Profile;name=$label} | ConvertTo-Json | Set-Content -Encoding UTF8 -LiteralPath $configPath
  Write-Output "Selected: $label. Sign in once in the dedicated browser; website sessions are not copied."
  exit 0
}

if (!(Test-Path -LiteralPath $configPath)) {
  if ($profiles.Count -eq 0) { throw 'NO_PROFILE: Tell the user to sign in or register an account. After they choose, run -Action Select -Profile New, then Start.' }
  if ($profiles.Count -gt 1) { throw 'CHOOSE_PROFILE: Run -Action List, ask the user which profile to use, then run -Action Select -Profile <directory>.' }
  New-Item -ItemType Directory -Force $runtime | Out-Null
  $profiles[0] | ConvertTo-Json | Set-Content -Encoding UTF8 -LiteralPath $configPath
}

$selection = Get-Content -Raw -LiteralPath $configPath | ConvertFrom-Json
if ($selection.directory -notmatch '^(Default|Profile [0-9]+|New)$') { throw 'Invalid saved profile directory. Select the profile again.' }
$dataDir = Join-Path $runtime ('data-' + $selection.directory.Replace(' ','-'))

function Get-Endpoint {
  $client = New-Object System.Net.WebClient
  $client.Proxy = $null
  try { return ($client.DownloadString("http://127.0.0.1:$port/json/version") | ConvertFrom-Json) } catch { return $null } finally { $client.Dispose() }
}

$owners = @(Get-CimInstance Win32_Process -Filter "name = 'chrome.exe'" | Where-Object { $_.CommandLine -like "*--remote-debugging-port=$port*" -and $_.CommandLine -notlike '*--type=*' })
if ($owners.Count -gt 0 -and @($owners | Where-Object { $_.CommandLine.Contains($dataDir) -or ($piBrowserDir -and $_.CommandLine.Contains($piBrowserDir)) }).Count -ne $owners.Count) {
  throw 'Port 9343 belongs to a different Chrome profile. Close that agent browser before switching accounts.'
}

$endpoint = Get-Endpoint
if ($endpoint -and $owners.Count -eq 0) { throw 'Port 9343 belongs to an unrecognized browser. Refusing to attach.' }

if (!$endpoint) {
  $chrome = @("$env:ProgramFiles\Google\Chrome\Application\chrome.exe", "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe", "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe") | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
  if (!$chrome) { throw 'Install Google Chrome first.' }
  $firstRun = !(Test-Path -LiteralPath (Join-Path $dataDir 'Default\Preferences'))
  $target = if ($firstRun) { 'https://accounts.google.com/' } else { 'about:blank' }
  Start-Process -FilePath $chrome -ArgumentList @("--remote-debugging-port=$port", '--remote-debugging-address=127.0.0.1', "--user-data-dir=`"$dataDir`"", '--profile-directory=Default', '--no-first-run', '--no-default-browser-check', $target) | Out-Null
  for ($attempt=0; $attempt -lt 40; $attempt++) {
    Start-Sleep -Milliseconds 250
    $endpoint = Get-Endpoint
    if ($endpoint) { break }
  }
  if (!$endpoint) { throw 'Chrome did not expose port 9343. Check whether the dedicated browser was already opened without debugging.' }
}

if ($Action -eq 'Start') {
  [pscustomobject]@{selected=$selection.name;port=$port;dataDirectory=$dataDir;browser=$endpoint.Browser;note='Check website login in the page. Sign in as the selected account if required.'} | ConvertTo-Json
  exit 0
}

$env:NO_PROXY = '127.0.0.1,localhost'
$env:no_proxy = $env:NO_PROXY
& npx.cmd -y chrome-devtools-mcp@latest --browserUrl "http://127.0.0.1:$port" --categoryExtensions=true
exit $LASTEXITCODE
