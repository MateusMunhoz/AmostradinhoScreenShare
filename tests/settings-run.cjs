const {spawnSync}=require('node:child_process');
const fs=require('node:fs'); const os=require('node:os'); const path=require('node:path');
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'tela-settings-'));
for (const phase of ['write','read']) {
  const r=spawnSync(require('electron'),[path.join(__dirname,'settings-smoke.cjs'),phase,profile],{stdio:'inherit',timeout:60000});
  if(r.error) console.error(r.error);
  if(r.status!==0) process.exit(r.status||1);
}
console.log('Configurações persistiram após encerrar e iniciar outro processo do app.');
