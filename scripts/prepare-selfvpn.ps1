$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Security\Microsoft.PowerShell.Security.psd1') -Force
$root = Split-Path $PSScriptRoot -Parent
$target = Join-Path $root 'bin\selfvpn'
$version = '1.1.1'
$expectedHash = '7BFED60AD61B785C914B38B61555A975488E1D3EC472DBFB2FCDF498FCA75242'
function Check-Signature([string]$File) {
  $sig = Get-AuthenticodeSignature -LiteralPath $File
  if ($sig.Status -ne 'Valid' -or $sig.SignerCertificate.Subject -notmatch '(?:^|, )O=WireGuard LLC(?:,|$)') { throw 'Assinatura oficial do WireGuard inválida.' }
}
$engine = Join-Path $target 'wireguard.exe'
if (Test-Path -LiteralPath $engine) {
  Check-Signature $engine
  if ((Get-Item -LiteralPath $engine).VersionInfo.ProductVersion -eq $version) { Write-Output 'WireGuard pronto.'; exit 0 }
}
$cache = Join-Path $root '.vpn-build'
New-Item -ItemType Directory -Path $cache -Force | Out-Null
$msi = Join-Path $cache "wireguard-amd64-$version.msi"
if (!(Test-Path -LiteralPath $msi)) {
  Invoke-WebRequest -UseBasicParsing -Uri "https://download.wireguard.com/windows-client/wireguard-amd64-$version.msi" -OutFile $msi
}
if ((Get-FileHash -LiteralPath $msi -Algorithm SHA256).Hash -ne $expectedHash) { throw 'Hash do pacote WireGuard inválido.' }
Check-Signature $msi
$extract = Join-Path $cache 'extracted'
New-Item -ItemType Directory -Path $extract -Force | Out-Null
# /a extrai os arquivos do MSI; não instala driver, serviço nem conecta a rede.
$process = Start-Process -FilePath (Join-Path $env:SystemRoot 'System32\msiexec.exe') -WindowStyle Hidden -Wait -PassThru -ArgumentList @('/a', "`"$msi`"", '/qn', "TARGETDIR=`"$extract`"")
if ($process.ExitCode -ne 0) { throw "Falha ao extrair WireGuard: $($process.ExitCode)" }
$found = @(Get-ChildItem -LiteralPath $extract -Filter wireguard.exe -File -Recurse)
if ($found.Count -ne 1) { throw 'Pacote WireGuard inesperado.' }
Check-Signature $found[0].FullName
New-Item -ItemType Directory -Path $target -Force | Out-Null
Copy-Item -LiteralPath $found[0].FullName -Destination $engine -Force
Check-Signature $engine
Write-Output 'WireGuard pronto para Windows x64. Nenhum túnel foi ativado.'
