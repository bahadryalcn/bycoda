$ErrorActionPreference = 'Stop'
$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$scheduler = New-Object -ComObject Schedule.Service
$scheduler.Connect()
try {
  $task = $scheduler.GetFolder('\').GetTask("Bycoda Host-$sid")
  'registered'
} catch {
  $cause = $_.Exception
  while ($null -ne $cause.InnerException) { $cause = $cause.InnerException }
  if ($cause.HResult -ne -2147024894) { throw }
  'absent'
}
