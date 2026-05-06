$ErrorActionPreference = "Stop"

$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$JavaHome = Join-Path $Root "tools\jdk17"
$AndroidHome = Join-Path $Root "tools\android-sdk"
$Gradle = Join-Path $Root "tools\gradle\bin\gradle.bat"
$Version = (Get-Content -Raw (Join-Path $Root "package.json") | ConvertFrom-Json).version
$KeyStore = Join-Path $Root "android\upload-key.jks"
$SigningProperties = Join-Path $Root "android\release-signing.properties"
$AabSource = Join-Path $Root "android\app\build\outputs\bundle\release\app-release.aab"
$ApkSource = Join-Path $Root "android\app\build\outputs\apk\release\app-release.apk"
$AabTarget = Join-Path $Root "JianjiMarkdown-v$Version.aab"
$ApkTarget = Join-Path $Root "JianjiMarkdown-v$Version.apk"

if (-not (Test-Path (Join-Path $JavaHome "bin\javac.exe")) -or
    -not (Test-Path $Gradle) -or
    -not (Test-Path (Join-Path $AndroidHome "platforms\android-35\android.jar"))) {
  throw "Android build tools are missing. Run scripts\setup-android-tools.ps1 first."
}

$env:JAVA_HOME = $JavaHome
$env:ANDROID_HOME = $AndroidHome
$env:ANDROID_SDK_ROOT = $AndroidHome
$env:Path = "$JavaHome\bin;$AndroidHome\platform-tools;$AndroidHome\cmdline-tools\latest\bin;$env:Path"

if (-not (Test-Path $SigningProperties)) {
  $StorePassword = [Guid]::NewGuid().ToString("N") + [Guid]::NewGuid().ToString("N")
  $KeyPassword = [Guid]::NewGuid().ToString("N") + [Guid]::NewGuid().ToString("N")
  $KeyTool = Join-Path $JavaHome "bin\keytool.exe"

  & $KeyTool -genkeypair `
    -v `
    -keystore $KeyStore `
    -storetype JKS `
    -storepass $StorePassword `
    -keypass $KeyPassword `
    -alias jianji-upload `
    -keyalg RSA `
    -keysize 2048 `
    -validity 10000 `
    -dname "CN=Jianji Markdown, OU=Jianji, O=Jianji, L=Unknown, S=Unknown, C=CN"

  $SigningContent = @"
storeFile=upload-key.jks
storePassword=$StorePassword
keyAlias=jianji-upload
keyPassword=$KeyPassword
"@
  [System.IO.File]::WriteAllText($SigningProperties, $SigningContent, [System.Text.Encoding]::ASCII)
}

Push-Location $Root
try {
  npm.cmd run android:assets
  & $Gradle -p android clean bundleRelease assembleRelease --no-daemon
  if ($LASTEXITCODE -ne 0) {
    throw "Gradle release build failed with exit code $LASTEXITCODE."
  }
  Copy-Item -LiteralPath $AabSource -Destination $AabTarget -Force
  Copy-Item -LiteralPath $ApkSource -Destination $ApkTarget -Force
  Write-Host "AAB built: $AabTarget"
  Write-Host "APK built: $ApkTarget"
} finally {
  Pop-Location
}
