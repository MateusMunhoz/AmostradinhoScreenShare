param([Parameter(Mandatory=$true)][ValidateSet('Connect','Disconnect','Validate')][string]$Action,
  [string]$RequestPath)
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Security\Microsoft.PowerShell.Security.psd1') -Force
$tunnelName = 'TelaP2PSelfVPN'
$serviceName = 'WireGuardTunnel$TelaP2PSelfVPN'
$firewallName = 'TelaP2P-SelfVPN-In'
$operationLock = $null
$ownsLock = $false

function Assert-Key([string]$Value) {
  if ($Value -cnotmatch '^[A-Za-z0-9+/]{43}=$' -or [Convert]::FromBase64String($Value).Length -ne 32 -or
      [Convert]::ToBase64String([Convert]::FromBase64String($Value)) -cne $Value -or $Value -eq ('A' * 43 + '=')) { throw 'Invalid key' }
}
function Get-Config($request) {
  $p = $request.profile
  Assert-Key $request.privateKey
  Assert-Key $p.serverKey
  if ($p.network -ne '10.77.0.0/24' -or $p.gateway -ne '10.77.0.1' -or
      $p.address -cnotmatch '^10\.77\.0\.(?:[2-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-4])$') { throw 'Invalid network' }
  if ($p.endpoint.Length -gt 260 -or $p.endpoint -cnotmatch '^(\[[0-9a-fA-F:]+\]|[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?):([0-9]{1,5})$') { throw 'Invalid endpoint' }
  $endpointPort = [int]$Matches[2]
  if ($endpointPort -lt 1 -or $endpointPort -gt 65535) { throw 'Invalid port' }
  return "[Interface]`nPrivateKey = $($request.privateKey)`nAddress = $($p.address)/32`nMTU = 1280`n`n[Peer]`nPublicKey = $($p.serverKey)`nEndpoint = $($p.endpoint)`nAllowedIPs = 10.77.0.0/24`nPersistentKeepalive = 25`n"
}
function Assert-NoReparse([string]$Path) {
  $cursor = [IO.Path]::GetFullPath($Path)
  while ($cursor) {
    if ((Test-Path -LiteralPath $cursor) -and ((Get-Item -LiteralPath $cursor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Reparse points are not allowed' }
    $parent = [IO.Directory]::GetParent($cursor)
    if (!$parent) { break }
    $cursor = $parent.FullName
  }
}
function Secure-Directory([string]$Path) {
  Assert-NoReparse $Path
  $acl = New-Object Security.AccessControl.DirectorySecurity
  $acl.SetAccessRuleProtection($true, $false)
  foreach ($sid in @('S-1-5-18', 'S-1-5-32-544')) {
    $principal = New-Object Security.Principal.SecurityIdentifier($sid)
    $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($principal, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')))
  }
  $acl.SetOwner((New-Object Security.Principal.SecurityIdentifier('S-1-5-32-544')))
  if (!(Test-Path -LiteralPath $Path)) { [IO.Directory]::CreateDirectory($Path, $acl) | Out-Null }
  $existing = Get-Acl -LiteralPath $Path
  if ($existing.GetOwner([Security.Principal.SecurityIdentifier]).Value -notin @('S-1-5-18', 'S-1-5-32-544')) { throw 'Unexpected directory owner' }
  foreach ($rule in $existing.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])) {
    if ($rule.AccessControlType -eq 'Allow' -and $rule.IdentityReference.Value -notin @('S-1-5-18', 'S-1-5-32-544') -and
        ($rule.FileSystemRights -band [Security.AccessControl.FileSystemRights]::Write)) { throw 'Unsafe directory permissions' }
  }
  Set-Acl -LiteralPath $Path -AclObject $acl
}
function Assert-Signed([string]$Path) {
  $sig = Get-AuthenticodeSignature -LiteralPath $Path
  if ($sig.Status -ne 'Valid' -or $sig.SignerCertificate.Subject -notmatch '(?:^|, )O=WireGuard LLC(?:,|$)') { throw 'Invalid WireGuard signature' }
}
function Remove-Tunnel([string]$Engine) {
  if (Get-Service -Name $serviceName -ErrorAction SilentlyContinue) {
    Assert-Signed $Engine
    & $Engine /uninstalltunnelservice $tunnelName
    if ($LASTEXITCODE -ne 0) { throw 'Could not remove tunnel' }
    for ($i = 0; $i -lt 50; $i++) {
      if (!(Get-Service -Name $serviceName -ErrorAction SilentlyContinue)) { return }
      Start-Sleep -Milliseconds 100
    }
    throw 'Tunnel removal still pending'
  }
}

try {
  if ($Action -eq 'Validate') {
    $request = [Console]::In.ReadToEnd() | ConvertFrom-Json
    $conf = Get-Config $request
    # Não devolve chaves nem aciona serviço, UAC, driver ou firewall.
    @{ valid = $true; address = $request.profile.address; network = '10.77.0.0/24' } | ConvertTo-Json -Compress
    exit 0
  }
  $who = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
  if (!$who.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Administrator required' }
  $operationLock = New-Object Threading.Mutex($false, 'Global\TelaP2PSelfVPN-Operation')
  try { $ownsLock = $operationLock.WaitOne(0) } catch [Threading.AbandonedMutexException] { $ownsLock = $true }
  if (!$ownsLock) { throw 'Another VPN operation is in progress' }
  # Caminhos fixos, independentes do convite e do conteúdo enviado pelo renderer.
  $root = Join-Path ([Environment]::GetFolderPath('CommonApplicationData')) 'TelaP2P-SelfVPN'
  Secure-Directory $root
  $engine = Join-Path $root 'wireguard.exe'
  $configuration = Join-Path $root ($tunnelName + '.conf')
  foreach ($file in @($engine, $configuration)) { Assert-NoReparse $file }
  if ($Action -eq 'Disconnect') {
    Remove-Tunnel $engine
    Get-NetFirewallRule -Name $firewallName -ErrorAction SilentlyContinue | Remove-NetFirewallRule
    if (Test-Path -LiteralPath $configuration) { Remove-Item -LiteralPath $configuration -Force }
    exit 0
  }
  $previousService = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
  if ($previousService) {
    if ($previousService.Status -ne 'Stopped') { throw 'Tunnel already active; disconnect first' }
    # O serviço manual permanece cadastrado após reiniciar o Windows.
    Remove-Tunnel $engine
  }
  Assert-NoReparse $RequestPath
  if ((Get-Item -LiteralPath $RequestPath).Length -gt 32768) { throw 'Request too large' }
  Add-Type -AssemblyName System.Security
  $sealed = [IO.File]::ReadAllBytes($RequestPath)
  $bytes = [Security.Cryptography.ProtectedData]::Unprotect($sealed, $null, [Security.Cryptography.DataProtectionScope]::LocalMachine)
  $request = [Text.Encoding]::UTF8.GetString($bytes) | ConvertFrom-Json
  [Array]::Clear($bytes, 0, $bytes.Length)
  $conf = Get-Config $request
  # Copia apenas o engine oficial, para uma pasta que usuários comuns não podem alterar.
  $source = Join-Path $PSScriptRoot 'selfvpn\wireguard.exe'
  Assert-Signed $source
  Copy-Item -LiteralPath $source -Destination $engine -Force
  Assert-Signed $engine
  [IO.File]::WriteAllText($configuration, $conf, (New-Object Text.UTF8Encoding($false)))
  try {
    & $engine /installtunnelservice $configuration
    if ($LASTEXITCODE -ne 0) { throw 'Could not install tunnel' }
    # Reconexão só por ação do usuário: não inicia automaticamente no próximo boot.
    Set-Service -Name $serviceName -StartupType Manual
    $service = Get-Service -Name $serviceName
    $service.WaitForStatus('Running', [TimeSpan]::FromSeconds(20))
    Get-NetFirewallRule -Name $firewallName -ErrorAction SilentlyContinue | Remove-NetFirewallRule
    # A rede é um grupo de confiança; entrada só na interface e faixa privadas da VPN.
    New-NetFirewallRule -Name $firewallName -DisplayName 'Tela P2P - rede VPN privada' -Direction Inbound -Action Allow -Profile Any -InterfaceAlias $tunnelName -RemoteAddress '10.77.0.0/24' | Out-Null
  } catch {
    Remove-Tunnel $engine
    Get-NetFirewallRule -Name $firewallName -ErrorAction SilentlyContinue | Remove-NetFirewallRule
    if (Test-Path -LiteralPath $configuration) { Remove-Item -LiteralPath $configuration -Force }
    throw
  }
  exit 0
} catch {
  # O launcher só precisa do código; detalhes podem conter dados privados da configuração.
  exit 1
} finally {
  if ($ownsLock) { $operationLock.ReleaseMutex() }
  if ($operationLock) { $operationLock.Dispose() }
}
