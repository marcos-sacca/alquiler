# Registra la tarea de Windows "TrackerAlquileres". Se ejecuta una sola vez, sin administrador.
# Corre a las 12:00 y cada vez que iniciás sesión (si ya se actualizó en las últimas 20 horas, no hace nada).
# Si la PC estaba apagada a las 12:00, corre apenas se prende (StartWhenAvailable).
$ErrorActionPreference = "Stop"
$usuario = "$env:USERDOMAIN\$env:USERNAME"
$accion = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$PSScriptRoot\actualizar.ps1`"" -WorkingDirectory $PSScriptRoot
# -User en el disparador de inicio de sesión: sin eso aplica a "cualquier usuario" y exige administrador.
$disparadores = @((New-ScheduledTaskTrigger -Daily -At 12:00), (New-ScheduledTaskTrigger -AtLogOn -User $usuario))
$config = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 1)
$principal = New-ScheduledTaskPrincipal -UserId $usuario -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName "TrackerAlquileres" -Action $accion -Trigger $disparadores -Settings $config -Principal $principal -Force | Out-Null
Write-Host "Listo: la tarea TrackerAlquileres quedo creada (12:00 y al iniciar sesion)."
