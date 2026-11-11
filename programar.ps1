# Registra una tarea de Windows que corre el tracker todos los días a las 12:00.
# Si la PC estaba apagada a esa hora, corre apenas se prende (StartWhenAvailable). Se ejecuta una sola vez.
$dir = $PSScriptRoot
$node = (Get-Command node).Source
$accion = New-ScheduledTaskAction -Execute $node -Argument "tracker.mjs" -WorkingDirectory $dir
$disparador = New-ScheduledTaskTrigger -Daily -At 12:00
$config = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 1)
Register-ScheduledTask -TaskName "TrackerAlquileres" -Action $accion -Trigger $disparador -Settings $config -Force | Out-Null
Write-Host "Listo: 'TrackerAlquileres' corre todos los días a las 12:00 (o al prender la PC si se la perdió)."
