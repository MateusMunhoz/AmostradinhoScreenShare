# Janela que faz o papel do jogo no teste do Ctrl+Enter (fecha sozinha depois de 2 minutos)
Add-Type -AssemblyName System.Windows.Forms
$f = New-Object System.Windows.Forms.Form
$f.Text = 'Jogo de teste Tela P2P'
$f.Width = 640; $f.Height = 400
$f.StartPosition = 'CenterScreen'
$t = New-Object System.Windows.Forms.Timer
$t.Interval = 120000
$t.Add_Tick({ $f.Close() })
$t.Start()
$f.Add_Shown({ $f.Activate() })
[System.Windows.Forms.Application]::Run($f)
