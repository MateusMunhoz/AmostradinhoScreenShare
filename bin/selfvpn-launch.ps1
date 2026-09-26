param([Parameter(Mandatory=$true)][ValidateSet('Connect','Disconnect')][string]$Action)
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Security\Microsoft.PowerShell.Security.psd1') -Force
$requestDirectory = $null
try {
  Add-Type -AssemblyName System.Security
  $payloadText = [Console]::In.ReadToEnd()
  if ($payloadText.Length -gt 8192) { throw 'Request too large' }
  $requestDirectory = Join-Path ([IO.Path]::GetTempPath()) ('tela-selfvpn-' + [Guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $requestDirectory | Out-Null
  $acl = New-Object Security.AccessControl.DirectorySecurity
  $acl.SetAccessRuleProtection($true, $false)
  $currentSid = [Security.Principal.WindowsIdentity]::GetCurrent().User
  foreach ($sid in @($currentSid, (New-Object Security.Principal.SecurityIdentifier('S-1-5-18')), (New-Object Security.Principal.SecurityIdentifier('S-1-5-32-544')))) {
    $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($sid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')))
  }
  Set-Acl -LiteralPath $requestDirectory -AclObject $acl
  $requestFile = Join-Path $requestDirectory 'request.bin'
  $bytes = [Text.Encoding]::UTF8.GetBytes($payloadText)
  $sealed = [Security.Cryptography.ProtectedData]::Protect($bytes, $null, [Security.Cryptography.DataProtectionScope]::LocalMachine)
  [IO.File]::WriteAllBytes($requestFile, $sealed)
  [Array]::Clear($bytes, 0, $bytes.Length)
  $payloadText = $null
  # Só caminhos entram no comando; a chave fica no stdin e no arquivo protegido.
  $control = (Join-Path $PSScriptRoot 'selfvpn-control.ps1').Replace("'", "''")
  $requestArg = $requestFile.Replace("'", "''")
  $command = "& '$control' -Action '$Action' -RequestPath '$requestArg'; exit `$LASTEXITCODE"
  $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($command))
  $ps = Join-Path $PSHOME 'powershell.exe'
  $process = Start-Process -FilePath $ps -Verb RunAs -WindowStyle Hidden -ArgumentList @('-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', $encoded) -Wait -PassThru
  exit $process.ExitCode
} catch {
  if ($_.Exception.NativeErrorCode -eq 1223) { exit 2 }
  exit 1
} finally {
  # Caminho criado por este processo; nenhuma exclusão recursiva.
  if ($requestDirectory) {
    $requestFile = Join-Path $requestDirectory 'request.bin'
    if (Test-Path -LiteralPath $requestFile) { Remove-Item -LiteralPath $requestFile -Force }
    if (Test-Path -LiteralPath $requestDirectory) { Remove-Item -LiteralPath $requestDirectory -Force }
  }
}
