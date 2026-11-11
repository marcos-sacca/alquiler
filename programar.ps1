# Registra la tarea de Windows "TrackerAlquileres". Se ejecuta una sola vez.
# Corre a las 12:00 y también cada vez que iniciás sesión; si ya se actualizó en las últimas 20 horas, no hace nada.
# Además, si la PC estaba apagada a las 12:00, corre apenas se prende (StartWhenAvailable).
$accion = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$PSScriptRoot\actualizar.ps1`"" -WorkingDirectory $PSScriptRoot
$disparadores = @((New-ScheduledTaskTrigger -Daily -At 12:00), (New-ScheduledTaskTrigger -AtLogOn))
$config = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 1)
Register-ScheduledTask -TaskName "TrackerAlquileres" -Action $accion -Trigger $disparadores -Settings $config -Force | Out-Null
Write-Host "Listo: 'TrackerAlquileres' actualiza y sube los datos a diario (12:00 o al iniciar sesión)."
