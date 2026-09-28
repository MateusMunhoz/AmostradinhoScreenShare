// A conexão cai e volta sozinha: Ana transmite e as duas estão na voz. A rede da Ana "some" por 15 s (o
// processo de rede do app dela fica congelado, como quando a VPN reinicia) e depois volta. A tela e a voz
// têm que voltar sem ninguém clicar em nada. Também força o caminho novo (ICE restart) e a chamada nova
// da voz, para conferir que a troca acontece sem derrubar nada.
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { openApp, createRoom, joinRoom, share, frames, check, sleep, run, profileDir } = require('./ajuda');

const PORT = 18811;
const firstVideo = '[...state.in.values()][0].tile.video';
const TONE = `(() => { window.tctx = new AudioContext(); const o = tctx.createOscillator(); const g = tctx.createGain(); g.gain.value = 0.3; const dst = tctx.createMediaStreamDestination(); o.connect(g); g.connect(dst); o.start(); voice.media = { getUserMedia: async () => dst.stream }; })()`;

// Congela ou solta o processo de rede (NetworkService) da cópia do app com esse perfil. O script vai num
// arquivo .ps1: passado inteiro pela linha de comando, o PowerShell perde as aspas do Add-Type.
function rede(tag, congelar) {
  const script = path.join(os.tmpdir(), 'tela-p2p-e2e', 'congelar-rede.ps1');
  fs.writeFileSync(script, `param([string]$Perfil, [string]$Acao)
Add-Type @"
using System; using System.Runtime.InteropServices;
public class NT9 { [DllImport("ntdll.dll")] public static extern int NtSuspendProcess(IntPtr h); [DllImport("ntdll.dll")] public static extern int NtResumeProcess(IntPtr h); }
"@
$all = Get-CimInstance Win32_Process -Filter "Name='electron.exe'"
$main = $all | Where-Object { $_.CommandLine -like "*$Perfil*" -and $_.CommandLine -notlike '*--type=*' } | Select-Object -First 1
$net = @($all | Where-Object { $_.ParentProcessId -eq $main.ProcessId -and $_.CommandLine -like '*network.mojom.NetworkService*' })
foreach ($p in $net) { $h = (Get-Process -Id $p.ProcessId).Handle; if ($Acao -eq 'congelar') { [void][NT9]::NtSuspendProcess($h) } else { [void][NT9]::NtResumeProcess($h) } }
$net.Count
`);
  return execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, profileDir(tag), congelar ? 'congelar' : 'soltar']).toString().trim();
}

run('A conexão volta sozinha', 200000, async () => {
  const H = await openApp('religH', 9711);                 // quem roda a sala (não congela)
  await createRoom(H, { name: 'Hugo', port: PORT });
  const A = await openApp('religA', 9712, { fake: true });
  await joinRoom(A, { name: 'Ana', addr: `127.0.0.1:${PORT}` });
  const B = await openApp('religB', 9713, { fake: true });
  await joinRoom(B, { name: 'Bia', addr: `127.0.0.1:${PORT}` });
  const idA = await A.eval('state.myId');
  const idB = await B.eval('state.myId');

  await share(A);
  await B.waitFor(`state.members.get('${idA}')?.sharing`);
  await B.eval(`watch('${idA}')`);
  await B.waitFor(`[...state.in.values()].every((l) => l.tile.video.videoWidth > 0)`, 20000);
  await A.eval(TONE);
  await B.eval(TONE);
  await A.eval(`$('voiceJoin').click()`);
  await B.eval(`$('voiceJoin').click()`);
  await B.waitFor(`voice.peers.get('${idA}')?.pc.connectionState === 'connected'`, 20000);
  check('Antes: Bia vê a tela e fala com a Ana', (await frames(B, firstVideo)) > 3);

  // 1) Caminho novo forçado (o que acontece depois de a conexão cair): a tela continua
  const ufrag = () => B.eval(`(state.in.get('${idA}').pc.remoteDescription.sdp.match(/a=ice-ufrag:(\\S+)/) || [])[1]`);
  const antes = await ufrag();
  await A.eval(`(() => { const l = state.out.get('${idB}'); l.chain = l.chain.then(async () => { await l.pc.setLocalDescription(await l.pc.createOffer({ iceRestart: true })); sendSignal('${idB}', { side: 'sharer', sdp: l.pc.localDescription }); }); })()`);
  await B.waitFor(`(state.in.get('${idA}').pc.remoteDescription.sdp.match(/a=ice-ufrag:(\\S+)/) || [])[1] !== ${JSON.stringify(antes)}`, 10000);
  await B.waitFor(`state.in.get('${idA}').pc.connectionState === 'connected'`, 10000);
  check('ICE restart: caminho novo negociado e a tela continua', (await frames(B, firstVideo)) > 3);

  // 2) Chamada nova da voz (quem inicia é o menor número): o outro lado troca pela nova
  const menor = Number(idA) < Number(idB) ? A : B;
  const outro = menor === A ? idB : idA;
  const chamada = await B.eval(`voice.peers.get('${idA}').call`);
  await menor.eval(`(() => { voice.close('${outro}'); voice.sync(); })()`);
  await B.waitFor(`voice.peers.get('${idA}')?.call !== ${JSON.stringify(chamada)} && voice.peers.get('${idA}')?.pc.connectionState === 'connected'`, 15000);
  check('Voz: chamada nova aceita pelo outro lado e conectada', true);

  // 3) A rede da Ana some por 15 s e volta: tudo tem que voltar sozinho
  const n = rede('religA', true);
  await sleep(15000);
  rede('religA', false);
  check('Rede da Ana congelada e solta', Number(n) >= 1, `${n} processo(s)`);
  await B.waitFor(`state.in.get('${idA}')?.pc.connectionState === 'connected'`, 45000);
  await sleep(1500);
  const f = await frames(B, firstVideo);
  check('Depois da queda: a tela da Ana voltou sozinha', f > 3, `${f} quadros em 1,5 s`);
  await B.waitFor(`voice.peers.get('${idA}')?.pc.connectionState === 'connected'`, 45000);
  check('Depois da queda: a voz voltou sozinha', true);
  check('Ninguém saiu da sala', (await B.eval(`state.members.has('${idA}')`)) && (await A.eval(`state.ws?.readyState === 1`)));
});
