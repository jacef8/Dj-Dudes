# Creates (or refreshes) a "DJ Dudes" icon on the Desktop and in the Start menu.
# The icon opens the app directly, with no black command window.
$app = $PSScriptRoot
$exe = Join-Path $app 'node_modules\electron\dist\electron.exe'
if (-not (Test-Path $exe)) {
  Write-Host 'DJ Dudes is not set up yet. Double-click "Start DJ Dudes.bat" first.'
  exit 1
}
$shell = New-Object -ComObject WScript.Shell
$places = @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs'))
foreach ($dir in $places) {
  if (-not $dir) { continue }
  $lnk = $shell.CreateShortcut((Join-Path $dir 'DJ Dudes.lnk'))
  $lnk.TargetPath = $exe
  $lnk.Arguments = '"' + $app + '"'
  $lnk.WorkingDirectory = $app
  $lnk.IconLocation = (Join-Path $app 'icon.ico') + ',0'
  $lnk.Description = 'DJ Dudes'
  $lnk.Save()
}
