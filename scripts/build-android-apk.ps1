$ErrorActionPreference = "Stop"

$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$JavaHome = Join-Path $Root "tools\jdk17"
$AndroidHome = Join-Path $Root "tools\android-sdk"
$Gradle = Join-Path $Root "tools\gradle\bin\gradle.bat"
$ApkSource = Join-Path $Root "android\app\build\outputs\apk\debug\app-debug.apk"
$ApkTarget = Join-Path $Root "JianjiMarkdown-debug.apk"

if (-not (Test-Path (Join-Path $JavaHome "bin\javac.exe")) -or
    -not (Test-Path $Gradle) -or
    -not (Test-Path (Join-Path $AndroidHome "platforms\android-35\android.jar"))) {
  throw "Android build tools are missing. Run scripts\setup-android-tools.ps1 first."
}

$env:JAVA_HOME = $JavaHome
$env:ANDROID_HOME = $AndroidHome
$env:ANDROID_SDK_ROOT = $AndroidHome
$env:Path = "$JavaHome\bin;$AndroidHome\platform-tools;$AndroidHome\cmdline-tools\latest\bin;$env:Path"

Push-Location $Root
try {
  npm.cmd run android:assets
  & $Gradle -p android assembleDebug --no-daemon
  Copy-Item -LiteralPath $ApkSource -Destination $ApkTarget -Force
  Write-Host "APK built: $ApkTarget"
} finally {
  Pop-Location
}
