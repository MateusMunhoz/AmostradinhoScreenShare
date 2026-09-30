const {app,BrowserWindow,ipcMain}=require('electron');
const fs=require('node:fs'); const path=require('node:path'); const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'); const phase=process.argv[2];
app.setPath('userData',process.argv[3]);
setTimeout(()=>{console.error('Timeout');app.exit(1);},45000);
app.whenReady().then(async()=>{
  for(const [channel,value] of Object.entries({
    'get-ips':[], 'get-version':'1.10.1', 'github-check':{ok:false}, 'set-priority':true,'stats-start':true,'stats-stop':true,
    'stop-app-audio':true,'stop-server':true,'room-keys':true,'sessoes-observar':true,'capture-exclude':true,'ptt':true,
    'razze-wg-connections':[],
    'razze-state':{configured:false,baseUrl:'',authenticated:false}, 'razze-pending-invite':'', 'window-material':{material:'none',supported:false}, 'window-titlebar':true,
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
      await check('Áreas de amigos, perfil e rede separadas', `$('profilePane').contains($('razzeAuth')) && $('friendsDialog').contains($('razzeStepFriends')) && !$('networkDialog').contains($('razzeAuth')) && !$('networkDialog').contains($('razzeStepFriends'))`);
      await check('Amigos abre e mantém o fundo bloqueado', `(() => {$('navFriends').click();return !$('friendsDialog').hidden && document.querySelector('main').inert && $('navFriends').getAttribute('aria-expanded')==='true';})()`);
      await check('Perfil fecha amigos e permite retornar à rede', `(() => {$('friendsOpenProfile').click();const ok=$('friendsDialog').hidden && !$('profilePane').hidden;$('profileOpenNetwork').click();return ok && $('profilePane').hidden && !$('networkDialog').hidden && document.querySelector('main').inert;})()`);
      await check('Escape fecha rede e restaura interação', `(() => {$('networkDialog').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));return $('networkDialog').hidden && !document.querySelector('main').inert;})()`);
      await check('Mapa abre, mostra servidor sem configuração e fecha com Escape', `(async()=>{$('navConnectionMap').click();await new Promise(r=>setTimeout(r,80));const ok=!$('connectionMapDialog').hidden && $('connectionGraph').querySelector('.connection-node.offline') && $('connectionMapEmpty').hidden===false;$('connectionMapDialog').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));return ok && $('connectionMapDialog').hidden && !document.querySelector('main').inert;})()`);
      await check('Grafo representa todas as redes e servidor com cores independentes', `(()=>{renderConnectionGraph({status:'offline',detail:'Sem conexão'},[{name:'Rede A',status:'online',detail:'Túnel conectado'},{name:'Rede B',status:'online',detail:'Túnel conectado'}]);return $('connectionGraph').querySelectorAll('.connection-node.online').length===2 && $('connectionGraph').querySelectorAll('.connection-edge.offline').length===1 && $('connectionMapDetails').children.length===3;})()`);
      await check('Mapa mantém rede selecionada e interfaces quando o inventário de túneis está vazio', `(()=>{const nodes=connectionMapLocalNodes([], [{name:'Radmin VPN',address:'26.1.2.3',radmin:true}],{networkPrefix:'aaaaaaaaaaaa',connected:true,networkName:'Minha rede'});return nodes.length===2 && nodes.every(n=>n.status==='online');})()`);
      await check('Mapa mostra sala ativa independentemente do servidor e não inventa um túnel', `(()=>{const previous={myId:state.myId,ws:state.ws,host:state.host};try{state.myId='map-test';state.ws={readyState:WebSocket.OPEN};state.host='26.1.2.3';const nodes=connectionMapLocalNodes([],[],null);return nodes.length===1 && nodes[0].name==='Sala atual' && nodes[0].status==='online';}finally{Object.assign(state,previous);}})()`);
      await check('Nomes das redes persistem para o mapa offline', `(()=>{rememberConnectionMapNetworks([{id:'e'.repeat(32),name:'Rede persistida'}]);connectionMapNames.clear();rememberConnectionMapNetworks([]);return connectionMapNames.get('e'.repeat(12))==='Rede persistida';})()`);
      await check('Botão abre configurações',`(() => {$('navSettings').click();return !$('generalSettingsDialog').hidden;})()`);
      await check('Todos os sons e a opção sem som',`$('sound-chat').options.length === AppPreferences.sounds.length + 1`);
      await check('Tema E.V.A liga fundo, letreiro e fonte; desfoque pelo controle; outro tema desliga', `(() => {
        const before = JSON.parse(JSON.stringify(appPreferences));
        document.querySelector('.theme-card[data-theme=eva]').click();
        const on = !$('wallpaper').hidden && !$('themeDecor').hidden && document.documentElement.dataset.wallpaper === 'eva'
          && getComputedStyle(document.body).fontFamily.startsWith('"Chakra Petch"') && !$('wallpaperControls').hidden;
        $('wallpaperBlur').value = '18'; $('wallpaperBlur').dispatchEvent(new Event('input'));
        const blur = appPreferences.appearance.blur === 18 && $('wallpaper').style.getPropertyValue('--wall-blur') === '18px' && AppPreferences.currentTheme(appPreferences) === 'eva';
        document.querySelector('input[name=wallpaper][value=""]').click();
        const none = $('wallpaper').hidden && !document.documentElement.dataset.wallpaper && $('wallpaperControls').hidden;
        document.querySelector('.theme-card[data-theme=lanhouse]').click();
        const off = $('themeDecor').hidden && !document.documentElement.dataset.decor;
        appPreferences = AppPreferences.normalize(before); saveAppPreferences(); renderGeneralSettings();
        return on && blur && none && off;
      })()`);
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
      await run(`document.querySelector('input[name=glass][value=liquid]').click();`);
      await check('Vidro líquido aplicado na hora',`document.documentElement.dataset.glass==='liquid' && getComputedStyle($('workspaceNav')).backdropFilter.includes('liquidLens') && !$('glassLevelRow').hidden`);
      await check('Abas: uma seção por vez',`(() => {$('settingsTab-colors').click();return !$('settingsPanel-colors').hidden && $('settingsPanel-sounds').hidden && $('settingsPanel-appearance').hidden && !$('settingsTab-network') && $('settingsTab-colors').getAttribute('aria-selected')==='true';})()`);
      await run(`$('settingsTab-appearance').click();$('fontFamily').nextElementSibling.click();0`);
      await check('Lista de fontes no tema, com vidro e cada fonte na própria letra',`(() => {const p=document.querySelector('.select-pop');return !!p && getComputedStyle(p).backdropFilter.includes('blur') && [...p.querySelectorAll('[role=option]')].some(o=>o.textContent.startsWith('Georgia')&&o.style.fontFamily.startsWith('Georgia')) && $('fontFamily').nextElementSibling.getAttribute('aria-expanded')==='true';})()`);
      await run(`[...document.querySelectorAll('.select-pop [role=option]')].find(o=>o.textContent.startsWith('Georgia')).click();0`);
      await check('Escolher na lista muda a fonte e fecha a lista',`!document.querySelector('.select-pop') && appPreferences.font.family==='georgia' && $('fontFamily').nextElementSibling.textContent.startsWith('Georgia')`);
      await run(`document.querySelector('input[name=border][value=liquid]').click();`);
      await check('Bordas líquidas: quina de cima acesa, cor translúcida, e o vidro continua',`document.documentElement.dataset.border==='liquid' && document.documentElement.dataset.glass==='liquid' && getComputedStyle($('workspaceNav')).borderTopColor!==getComputedStyle($('workspaceNav')).borderBottomColor && getComputedStyle(document.documentElement).getPropertyValue('--line').startsWith('rgba(')`);
      await run(`document.querySelector('input[name=border][value=solid]').click();`);
      await check('Bordas normais voltam à cor cheia',`document.documentElement.dataset.border==='solid' && AppPreferences.read(localStorage).appearance.border==='solid' && getComputedStyle(document.documentElement).getPropertyValue('--line').startsWith('#')`);
      await run(`document.querySelector('.theme-card[data-theme=neon]').click();0`);
      await check('Tema pronto aplica cores, vidro e bordas e fica marcado',`appPreferences.colors.main==='#0B0A14' && document.documentElement.dataset.glass==='clear' && document.documentElement.dataset.border==='clear' && document.querySelector('.theme-card[data-theme=neon]').getAttribute('aria-checked')==='true' && document.querySelectorAll('.theme-card[aria-checked=true]').length===1`);
      await check('Barra de título: botões do Windows transparentes com vidro e na cor do texto',`/^#00000000#[0-9A-F]{6}$/.test(titleBarKey) && getComputedStyle($('titlebar')).backgroundColor==='rgba(0, 0, 0, 0)'`);
      await run(`document.querySelector('.theme-card[data-theme=claro]').click();0`);
      await check('Tema opaco: barra de título na cor principal',`titleBarKey.startsWith('#EEF2F8') && document.documentElement.dataset.glass==='opaque'`);
      await run(`document.querySelector('.theme-card[data-theme=lanhouse]').click();document.querySelector('input[name=glass][value=liquid]').click();0`);
      await run(`$('profileNameFont').value='segoeScript';$('profileNameFont').dispatchEvent(new Event('change'));`);
      await check('Fonte do nome salva e aplicada no perfil, sem mudar o resto do app',`AppPreferences.read(localStorage).nameFont==='segoeScript' && getComputedStyle($('profileDisplayName')).fontFamily.startsWith('"Segoe Script"') && !getComputedStyle(document.body).fontFamily.includes('Segoe Script') && memberRow(null,'Eu',false).querySelector('.mname').style.fontFamily.startsWith('"Segoe Script"')`);
      await run(`$('profileNameFont').value='';$('profileNameFont').dispatchEvent(new Event('change'));`);
      await check('Sem escolha, o nome volta à fonte padrão',`AppPreferences.read(localStorage).nameFont==='' && $('profileDisplayName').style.fontFamily===''`);
      await run(`$('fontFamily').value='georgia';$('fontFamily').dispatchEvent(new Event('change'));`);
      await check('Fonte trocada no app, chat com a letra de console',`getComputedStyle(document.body).fontFamily.startsWith('Georgia') && getComputedStyle(document.querySelector('.chat-list')).fontFamily.startsWith('Tahoma')`);
      await run(`$('fontChat').click();`);
      await check('Fonte também no chat quando marcado',`getComputedStyle(document.querySelector('.chat-list')).fontFamily.startsWith('Georgia')`);
      await run(`$('fontFamily').value='custom';$('fontFamily').dispatchEvent(new Event('change'));$('fontCustom').value='Fonte Que Nao Existe';$('fontCustom').dispatchEvent(new Event('input'));`);
      await check('Nome digitado vira a fonte e avisa se não existe',`!$('fontCustomRow').hidden && getComputedStyle(document.body).fontFamily.startsWith('"Fonte Que Nao Existe"') && $('fontStatus').textContent.includes('não foi encontrada')`);
      await check('Versão discreta no pé das configurações',`$('settingsVersion').textContent==='v1.10.1'`);
      await run(`document.querySelector('input[name=glass][value=opaque]').click();$('fontFamily').value='system';$('fontFamily').dispatchEvent(new Event('change'));$('fontChat').click();`);
      await check('Opaco e fonte padrão restauram o visual original',`document.documentElement.dataset.glass==='opaque' && getComputedStyle($('workspaceNav')).backdropFilter==='none' && getComputedStyle(document.body).fontFamily.startsWith('"Segoe UI Variable Text"')`);
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
      await check('Painel cabe em 820 × 560 e permite rolar',`(() => {showSettingsTab('sounds');const c=$('generalSettingsDialog').firstElementChild;const r=c.getBoundingClientRect();return r.top>=0&&r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight&&c.scrollWidth<=c.clientWidth+1&&c.scrollHeight>c.clientHeight;})()`);
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

