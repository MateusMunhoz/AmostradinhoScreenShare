const {app,BrowserWindow,ipcMain}=require('electron');
const fs=require('node:fs'); const path=require('node:path'); const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'); const phase=process.argv[2];
app.setPath('userData',process.argv[3]);
setTimeout(()=>{console.error('Timeout');app.exit(1);},45000);
app.whenReady().then(async()=>{
  for(const [channel,value] of Object.entries({
    'get-ips':[], 'get-version':'1.10.1', 'github-check':{ok:false}, 'set-priority':true,'stats-start':true,'stats-stop':true,
    'stop-app-audio':true,'stop-server':true,'room-keys':true,'sessoes-observar':true,'capture-exclude':true,'ptt':true,
    'get-shortcuts':{compose:'CommandOrControl+Enter',mute:'CommandOrControl+Shift+M',edit:'CommandOrControl+Shift+E',hideChat:'CommandOrControl+Shift+O'},
  })) ipcMain.handle(channel,()=>value);
  const win=new BrowserWindow({show:false,width:1200,height:780,webPreferences:{backgroundThrottling:false,preload:path.join(root,'preload.js')}});
  win.webContents.setWindowOpenHandler(()=>({action:'allow',overrideBrowserWindowOptions:{show:false}}));
  const errors=[]; win.webContents.on('console-message',(_e,level,msg)=>{if(level>=3)errors.push(msg);});
  const run=code=>win.webContents.executeJavaScript(code);
  const check=async(label,code)=>{assert.ok(await run(code),label);console.log('OK '+label);};
  try {
    await win.loadFile(path.join(root,'index.html'));
    await new Promise(r=>setTimeout(r,300));
    if(phase==='read') {
      await check('Persistência após reiniciar',`appPreferences.colors.main === '#F0F4FA' && appPreferences.colors.secondary === '#FFFFFF' && appPreferences.colors.detail1 === '#3455DB' && appPreferences.colors.detail2 === '#147D55' && appPreferences.sounds.chatMuted && appPreferences.sounds.join === 'notification066' && appPreferences.sounds.volume === 27`);
      await check('Tema reaplicado na inicialização',`getComputedStyle(document.body).backgroundColor === 'rgb(240, 244, 250)'`);
      await check('Volumes individuais e escolha de voz persistem',`appPreferences.sounds.levels.voiceJoin===35 && appPreferences.sounds.voiceLeave==='wood'`);
      await check('Seleção de painéis persiste',`workspaceViews.voice===false && workspaceViews.chat===true && workspaceViews.streams===true`);
    } else {
      await run(`window.navBefore=$('workspaceNav').getBoundingClientRect().toJSON();void 0;`);
      await check('Perfil e engrenagem disponíveis fora da sala',`!$('navProfile').hidden && !$('navSettings').hidden && $('navChat').hidden && $('navVoice').hidden && $('navStreams').hidden`);
      await check('Botão abre configurações',`(() => {$('navSettings').click();return !$('generalSettingsDialog').hidden;})()`);
      await check('Todos os sons e a opção sem som',`$('sound-chat').options.length === AppPreferences.sounds.length + 1`);
      await check('Áudios locais decodificáveis',`(async()=>{for(const s of AppPreferences.sounds.filter(s=>s.file)) await new Promise((resolve,reject)=>{const a=new Audio('assets/audio/'+s.file);a.onloadedmetadata=()=>a.duration>0?resolve():reject(new Error(s.file));a.onerror=()=>reject(new Error(s.file));});return true;})()`);
      await run(`window.testPlayed=[];appSounds.createAudio=url=>({pause(){},play(){testPlayed.push(url);return Promise.resolve();}});appSounds.synth=notes=>{testPlayed.push('synth:'+notes[0][0]);return {pause(){}};};appSounds.now=()=>testPlayed.length*1000+1000;void 0;`);
      await run(`enterRoom({id:'self',features:['chat','voice'],members:[{id:'ana',name:'Ana'}],chat:[{id:'old',from:'ana',name:'Ana',ts:Date.now(),text:'histórico'}]},false,'127.0.0.1',8765)`);
      await check('Barra mantém exatamente a posição ao entrar',`(()=>{const r=$('workspaceNav').getBoundingClientRect();return r.x===navBefore.x&&r.y===navBefore.y&&r.width===navBefore.width;})()`);
      await check('Chat, voz e transmissão visíveis juntos',`!$('chatTab').hidden && !$('voicePane').hidden && !$('streamArea').hidden`);
      await check('Entrada inicial avisa uma vez; histórico silencioso',`testPlayed.length===1`);
      await run(`onRoomMessage({type:'member-joined',id:'bia',name:'Bia'});onRoomMessage({type:'member-joined',id:'bia',name:'Bia'});onRoomMessage({type:'member-left',id:'bia'});onRoomMessage({type:'member-left',id:'bia'});onChatMessage({id:'new',from:'self',name:'Eu',ts:Date.now(),text:'teste'});onChatMessage({id:'new',from:'self',name:'Eu',ts:Date.now(),text:'teste'});`);
      await check('Entrada, saída e mensagem sem duplicatas',`testPlayed.length===4`);
      await run(`$('muteChatSound').click();onChatMessage({id:'muted',from:'ana',name:'Ana',ts:Date.now(),text:'silêncio'});`);
      await check('Silêncio do chat preserva outros sons',`testPlayed.length===4`);
      await run(`$('preview-chat').click()`);
      await check('Prévia funciona mesmo com chat silenciado',`testPlayed.length===5`);
      await run(`onRoomMessage({type:'voice-state',id:'ana',session:'s0',muted:false});onRoomMessage({type:'voice-state',id:'ana',session:'',muted:false});`);
      await check('Fora da voz, a voz dos outros não toca',`testPlayed.length===5`);
      await run(`voice.session='eu';onRoomMessage({type:'voice-state',id:'ana',session:'session1',muted:false});onRoomMessage({type:'voice-state',id:'ana',session:'session1',muted:true});onRoomMessage({type:'voice-state',id:'ana',session:'session2',muted:false});onRoomMessage({type:'voice-state',id:'ana',session:'',muted:false});`);
      await check('Na voz: entrada e saída tocam (Suave), mute e reconexão não',`testPlayed.length===7 && testPlayed[5]==='synth:660' && testPlayed[6]==='synth:880'`);
      await run(`voice.muted=true;renderVoice();voice.muted=false;renderVoice();voice.session='';renderVoice();`);
      await check('Mutar e desmutar o seu microfone tocam',`testPlayed.length===9 && testPlayed[7]==='synth:659' && testPlayed[8]==='synth:523'`);
      await run(`$('volume-voiceJoin').value=35;$('volume-voiceJoin').dispatchEvent(new Event('input'));$('sound-voiceLeave').value='wood';$('sound-voiceLeave').dispatchEvent(new Event('change'));`);
      await run(`$('hex-main').value='#GGGGGG';$('hex-main').dispatchEvent(new Event('input'));`);
      await check('Hexadecimal inválido não é salvo',`$('hex-main').getAttribute('aria-invalid')==='true' && AppPreferences.read(localStorage).colors.main==='#22271E'`);
      await run(`toggleChatOverlay();void 0;`);
      await run(`for(const [key,value] of Object.entries({main:'#F0F4FA',secondary:'#FFFFFF',detail1:'#3455DB',detail2:'#147D55'})){$('hex-'+key).value=value;$('hex-'+key).dispatchEvent(new Event('input'));} $('sound-join').value='notification066';$('sound-join').dispatchEvent(new Event('change'));$('notificationVolume').value=27;$('notificationVolume').dispatchEvent(new Event('input'));`);
      await check('Quatro cores aplicadas imediatamente',`getComputedStyle(document.body).backgroundColor==='rgb(240, 244, 250)' && getComputedStyle($('generalSettingsDialog').firstElementChild).backgroundColor==='rgb(255, 255, 255)'`);
      await check('Janela flutuante atualiza tema sem reabrir',`overlay.p.win.document.documentElement.style.getPropertyValue('--panel') === '#FFFFFF' && overlay.p.win.getComputedStyle(overlay.p.input).color === 'rgb(0, 0, 0)'`);
      await run(`closeChatOverlay();void 0;`);
      fs.mkdirSync(path.join(root,'.test-profile'),{recursive:true});
      win.setSize(1202,780); await new Promise(r=>setTimeout(r,150));win.setSize(1200,780);await new Promise(r=>setTimeout(r,200));
      fs.writeFileSync(path.join(root,'.test-profile','settings-light.png'),(await win.webContents.capturePage()).toPNG());
      win.setSize(820,560); await new Promise(r=>setTimeout(r,150));
      // Quem rola é o cartão do diálogo (o fundo escuro só centraliza)
      await check('Painel cabe em 820 × 560 e permite rolar',`(() => {const c=$('generalSettingsDialog').firstElementChild;const r=c.getBoundingClientRect();return r.top>=0&&r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight&&c.scrollWidth<=c.clientWidth+1&&c.scrollHeight>c.clientHeight;})()`);
      fs.writeFileSync(path.join(root,'.test-profile','settings-small.png'),(await win.webContents.capturePage()).toPNG());
      await run(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}))`);
      await check('Escape fecha configurações',`$('generalSettingsDialog').hidden`);
      await run(`$('navSettings').click()`);
      await check('Configurações acessíveis na sala',`!$('generalSettingsDialog').hidden`);
      await run(`closeGeneralSettings();void 0;`);
      for(let mask=0;mask<8;mask++) {
        await run(`for(const [id,on] of [['navChat',${!!(mask&1)}],['navVoice',${!!(mask&2)}],['navStreams',${!!(mask&4)}]])if(($(id).getAttribute('aria-pressed')==='true')!==on)$(id).click();`);
        await check('Painéis independentes, combinação '+mask,`$('chatTab').hidden===${!(mask&1)} && $('voicePane').hidden===${!(mask&2)} && $('streamArea').hidden===${!(mask&4)} && document.documentElement.scrollWidth<=innerWidth`);
      }
      // Perfil e configurações são janelas por cima: abrir uma fecha a outra; os painéis da sala continuam
      await run(`openProfilePopup();openGeneralSettings();`);
      await check('Configurações abrem por cima, fecham o perfil e mantêm os painéis',`$('profilePane').hidden && !$('generalSettingsDialog').hidden && !$('chatTab').hidden && !$('voicePane').hidden && !$('streamArea').hidden`);
      await run(`closeGeneralSettings();$('navVoice').click();`);
      win.setSize(1600,950);await new Promise(r=>setTimeout(r,250));
      fs.writeFileSync(path.join(root,'.test-profile','workspace-room.png'),(await win.webContents.capturePage()).toPNG());
      await run(`leaveRoom();void 0;`);
      await check('Saída oculta painéis da sala e mantém navegação global',`$('navChat').hidden && $('navVoice').hidden && $('navStreams').hidden && !$('navProfile').hidden && !$('navSettings').hidden && $('chatTab').hidden && $('voicePane').hidden`);
      win.webContents.session.flushStorageData();
    }
    assert.deepEqual(errors,[],'Erros no renderer');
    app.exit(0);
  }catch(e){console.error(e, errors);app.exit(1);}
});

