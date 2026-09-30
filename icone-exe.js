// Depois de empacotar (afterPack do electron-builder): põe o ícone do app no Tela P2P.exe de dentro, o que o
// portátil extrai e roda (Gerenciador de Tarefas, ícone fixado na barra). O electron-builder faria isso sozinho,
// mas o signAndEditExecutable fica desligado: a ferramenta dele (winCodeSign) não abre sem permissão de criar
// links simbólicos no Windows. O rcedit do npm já vem pronto e não precisa disso.
const path = require('path');
const rcedit = require('rcedit');

module.exports = async function iconeNoExe(context) {
  if (context.electronPlatformName !== 'win32') return;
  const exe = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.exe`);
  // O ícone do build: o de win.icon (npm run dist:eva troca pelo do EVA-01), senão o padrão
  const icon = path.join(context.packager.projectDir, context.packager.config.win?.icon || 'assets/icone/tela-p2p.ico');
  await rcedit(exe, { icon });
  console.log(`  • ícone do app aplicado  file=${path.relative(context.packager.projectDir, exe)}`);
};
