$ErrorActionPreference = "Stop"

$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$Tools = Join-Path $Root "tools"
$Downloads = Join-Path $Tools "downloads"
$JdkDir = Join-Path $Tools "jdk17"
$GradleDir = Join-Path $Tools "gradle"
$SdkDir = Join-Path $Tools "android-sdk"
$CmdlineLatest = Join-Path $SdkDir "cmdline-tools\latest"

$JdkZip = Join-Path $Downloads "jdk17.zip"
$GradleZip = Join-Path $Downloads "gradle-8.2.1-bin.zip"
$CmdlineZip = Join-Path $Downloads "commandlinetools-win.zip"

New-Item -ItemType Directory -Force -Path $Downloads | Out-Null

function Download-IfMissing($Url, $Path) {
  if ((Test-Path $Path) -and (Test-Zip $Path)) {
    return
  }

  if (Test-Path $Path) {
    Write-Host "Removing incomplete download $Path"
    Remove-Item -LiteralPath $Path -Force
  }

  Write-Host "Downloading $Url"
  Invoke-WebRequest -Uri $Url -OutFile $Path
}

function Test-Zip($Path) {
  try {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [System.IO.Compression.ZipFile]::OpenRead($Path)
    $archive.Dispose()
    return $true
  } catch {
    return $false
  }
}

function Reset-Directory($Path) {
  if (Test-Path $Path) {
    Remove-Item -LiteralPath $Path -Recurse -Force
  }
  New-Item -ItemType Directory -Force -Path $Path | Out-Null
}

Download-IfMissing "https://aka.ms/download-jdk/microsoft-jdk-17-windows-x64.zip" $JdkZip
Download-IfMissing "https://services.gradle.org/distributions/gradle-8.2.1-bin.zip" $GradleZip
Download-IfMissing "https://dl.google.com/android/repository/commandlinetools-win-14742923_latest.zip" $CmdlineZip

if (-not (Test-Path (Join-Path $JdkDir "bin\javac.exe"))) {
  Reset-Directory $JdkDir
  $TempJdk = Join-Path $Tools "jdk17-extract"
  Reset-Directory $TempJdk
  Expand-Archive -LiteralPath $JdkZip -DestinationPath $TempJdk -Force
  $JdkHome = Get-ChildItem $TempJdk -Directory | Select-Object -First 1
  Copy-Item -Path (Join-Path $JdkHome.FullName "*") -Destination $JdkDir -Recurse -Force
  Remove-Item -LiteralPath $TempJdk -Recurse -Force
}

if (-not (Test-Path (Join-Path $GradleDir "bin\gradle.bat"))) {
  Reset-Directory $GradleDir
  $TempGradle = Join-Path $Tools "gradle-extract"
  Reset-Directory $TempGradle
  Expand-Archive -LiteralPath $GradleZip -DestinationPath $TempGradle -Force
  $GradleHome = Get-ChildItem $TempGradle -Directory | Select-Object -First 1
  Copy-Item -Path (Join-Path $GradleHome.FullName "*") -Destination $GradleDir -Recurse -Force
  Remove-Item -LiteralPath $TempGradle -Recurse -Force
}

if (-not (Test-Path (Join-Path $CmdlineLatest "bin\sdkmanager.bat"))) {
  Reset-Directory $CmdlineLatest
  $TempCmdline = Join-Path $Tools "cmdline-extract"
  Reset-Directory $TempCmdline
  Expand-Archive -LiteralPath $CmdlineZip -DestinationPath $TempCmdline -Force
  $ExtractedCmdline = Join-Path $TempCmdline "cmdline-tools"
  Copy-Item -Path (Join-Path $ExtractedCmdline "*") -Destination $CmdlineLatest -Recurse -Force
  Remove-Item -LiteralPath $TempCmdline -Recurse -Force
}

$env:JAVA_HOME = $JdkDir
$env:ANDROID_HOME = $SdkDir
$env:ANDROID_SDK_ROOT = $SdkDir
$env:Path = "$JdkDir\bin;$SdkDir\platform-tools;$SdkDir\cmdline-tools\latest\bin;$GradleDir\bin;$env:Path"

$SdkManager = Join-Path $CmdlineLatest "bin\sdkmanager.bat"
$LicenseInput = ("y`n" * 100)
$LicenseInput | & $SdkManager --sdk_root=$SdkDir --licenses
& $SdkManager --sdk_root=$SdkDir "platform-tools" "platforms;android-35" "build-tools;35.0.0"

Write-Host "Android tools ready."
Write-Host "JAVA_HOME=$JdkDir"
Write-Host "ANDROID_HOME=$SdkDir"
