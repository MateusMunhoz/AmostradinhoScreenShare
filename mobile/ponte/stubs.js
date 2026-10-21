// O que o window.api do desktop tem e o iPhone ainda não faz (Fase 0: tudo que não é base). Cada entrada devolve o mesmo
// formato que o Electron devolve, para o renderer não precisar de caso especial; nada lança de forma síncrona.
// Tipos:
//   valor  Promise que resolve com o valor (cópia nova a cada chamada, para ninguém mexer no padrão)
//   erro   Promise que rejeita com a mensagem, como a RazzeAPI faz quando algo dá errado (a interface já mostra e.message)
//   evento função síncrona que não faz nada (on…/off…: nunca chega evento)
const SEM_CONTA = 'A conta Razze ainda não está disponível no iPhone.';
const SO_ENTRAR = 'No iPhone dá para entrar nas salas, não criar.';
const SEM_TRANSMITIR = 'Transmitir a tela não está disponível no iPhone.';
const NAO_EXISTE = 'Isso não existe no iPhone.';

const v = (valor) => ['valor', valor];
const e = (msg) => ['erro', msg];
const ev = ['evento'];

export const STUBS = {
  // Transmitir (fica escondido no iOS; as respostas são as do Linux/sem placa)
  getSources: v([]),
  selectSource: v(undefined),
  listAudioApps: v([]),
  startAppAudio: v({ ok: false, error: SEM_TRANSMITIR }),
  stopAppAudio: v(undefined),
  onPcm: ev,
  offPcm: ev,
  videoCapProbe: v({ nvenc: false, error: SEM_TRANSMITIR }),
  videoCapStart: v({ ok: false, error: SEM_TRANSMITIR }),
  videoCapStop: v(undefined),
  videoCapCmd: v(undefined),
  onVideoCap: ev,
  offVideoCap: ev,
  captureExclude: v(undefined),
  clipSave: v({ ok: false, error: NAO_EXISTE }),
  clipShow: v(undefined),

  // Janelas e atalhos do PC
  pipSetEdit: v(undefined),
  pipSize: v(undefined),
  pipOpacity: v(undefined),
  pipGroup: v(undefined),
  onPip: ev,
  chatCompose: v(undefined),
  roomKeys: v(false),
  fecharNaBandeja: v(undefined),
  getShortcuts: v({}),
  setShortcut: v({ ok: false, error: NAO_EXISTE }),
  ptt: v(undefined),
  windowMaterial: v(undefined),
  setTitleBar: v(undefined),
  setWindowIcon: v(undefined),
  captureRegion: v(null),
  setPriority: v(undefined),
  statsStart: v(undefined),
  statsStop: v(undefined),
  onStats: ev,
  offStats: ev,

  // Comando de voz e pedidos livres
  vozCmdEstado: v({ suportado: false, programa: false, modelos: [], baixando: false }), // o mesmo de main/comando-voz.js fora do Windows
  vozCmdInstalar: v({ ok: false, error: NAO_EXISTE }),
  vozCmdCancelar: v(undefined),
  vozCmdRemover: v(undefined),
  vozCmdTranscrever: v({ ok: false, error: NAO_EXISTE }),
  vozCmdTecla: v(undefined),
  vozIaEstado: v({ temChave: false, nuvem: false }),
  vozIaChave: v({ ok: false, error: NAO_EXISTE }),
  vozIaApagarChave: v(undefined),
  vozIaEntender: v({ ok: false, error: NAO_EXISTE }),
  vozIaTestar: v({ ok: false, error: NAO_EXISTE }),
  vozCmdYoutube: v(null),
  onVozCmd: ev,

  // Atividade (jogo e música do PC) e configurações no celular
  atividadeLer: v({ jogo: '', jogoImagem: '', musica: null }),
  atividadeSteamJogos: v([]),
  aoMudarMusica: ev,
  celularEntregar: v({ ok: false, error: NAO_EXISTE }),
  celularReceber: v({ ok: false, error: NAO_EXISTE }),
  celularFechar: v(true),
  onCelular: ev,

  // Rede e hospedar sala
  getIps: v([]),
  startServer: v({ ok: false, error: SO_ENTRAR }),
  stopServer: v(undefined),
  sessoesObservar: v(undefined),
  onSessoes: ev,
  razzeWireGuardConnections: v([]),
  razzeWireGuardStatus: v({ connected: false, error: 'Indisponível no iPhone.' }),
  razzeWireGuardConnect: e('Indisponível no iPhone.'),
  razzeWireGuardDisconnect: v({ connected: false }),
  razzeWireGuardDisconnectAll: v(undefined),
  razzeWireGuardResume: v({ connected: false, error: 'Indisponível no iPhone.' }),

  // Atualização (no iPhone é pelo AltStore/SideStore): sem pacote para repassar pela sala
  getOwnPack: v(null),
  installUpdate: v({ ok: false, error: NAO_EXISTE }),
  restartApp: v(undefined),
  githubCheck: v({ ok: false, error: 'No iPhone, atualize pelo SideStore ou AltStore.' }),
  githubInstall: v({ ok: false, error: NAO_EXISTE }),
  openGithub: v(undefined),

  // Conta Razze e mensagens (Fase 2): por enquanto "sem conta". As leituras devolvem vazio; o resto rejeita com a mensagem
  razzeState: v({ configured: false, baseUrl: '', authenticated: false }),
  razzePresence: v(null),
  razzeInternetRoom: v(undefined),
  razzeSalaAtual: v(undefined),
  onRazzePresence: ev,
  razzePendingInvite: v(''),
  onRazzeInvite: ev,
  razzePendingFriendLink: v(''),
  onFriendLink: ev,
  razzeConfigure: e(SEM_CONTA),
  razzeHealth: e(SEM_CONTA),
  razzeMe: e(SEM_CONTA),
  razzeRegister: e(SEM_CONTA),
  razzeConfirmEmail: e(SEM_CONTA),
  razzeResendConfirmation: e(SEM_CONTA),
  razzeLogin: e(SEM_CONTA),
  razzeLogin2fa: e(SEM_CONTA),
  razzeForgot: e(SEM_CONTA),
  razzeForgotReset: e(SEM_CONTA),
  razzeLogout: v(undefined),
  razzeListNetworks: e(SEM_CONTA),
  razzeCreateNetwork: e(SEM_CONTA),
  razzeUpdateNetwork: e(SEM_CONTA),
  razzeDeleteNetwork: e(SEM_CONTA),
  razzeAcceptInvite: e(SEM_CONTA),
  razzeListMembers: e(SEM_CONTA),
  razzeRemoveMember: e(SEM_CONTA),
  razzeCreateInvite: e(SEM_CONTA),
  razzeFriends: e(SEM_CONTA),
  razzeFriendRequests: e(SEM_CONTA),
  razzeRequestFriend: e(SEM_CONTA),
  razzeRequestFriendId: e(SEM_CONTA),
  razzeAcceptFriend: e(SEM_CONTA),
  razzeCancelFriendRequest: e(SEM_CONTA),
  razzeRemoveFriend: e(SEM_CONTA),
  razzeGoogleConfig: v({ enabled: false }),
  razzeGoogleLogin: e('Entrar com o Google não está disponível no iPhone.'),
  razzeGoogleFinish: e(SEM_CONTA),
  razzeGoogleLink: e(SEM_CONTA),
  razzeGoogleLinkPending: e(SEM_CONTA),
  razzeGooglePending: v(null),
  razzeGoogleMove: e(SEM_CONTA),
  razzeGoogleUnlink: e(SEM_CONTA),
  razzeChangePassword: e(SEM_CONTA),
  razzeSetHandle: e(SEM_CONTA),
  razzeKeepHandle: e(SEM_CONTA),
  razzeChangeEmail: e(SEM_CONTA),
  razzeVerifyEmail: e(SEM_CONTA),
  razzeConfirmEmailChange: e(SEM_CONTA),
  razzePasswordSetup: e(SEM_CONTA),
  razze2faSetup: e(SEM_CONTA),
  razze2faEnable: e(SEM_CONTA),
  razze2faDisable: e(SEM_CONTA),
  razze2faRecovery: e(SEM_CONTA),
  razzeResetPassword: e(SEM_CONTA),
  razzeSetActivity: v(undefined),
  razzeSetBio: v(undefined),
  razzeFeedback: e(SEM_CONTA),
  razzeFriendLinkCreate: e(SEM_CONTA),
  razzeFriendLinkList: e(SEM_CONTA),
  razzeFriendLinkRevoke: e(SEM_CONTA),
  razzeFriendLinkPreview: e(SEM_CONTA),
  razzeFriendLinkAccept: e(SEM_CONTA),
  razzeAdmin: e(SEM_CONTA),
  razzeSendMessage: e(SEM_CONTA),
  razzeMessages: v({ messages: [] }),
  dmList: v([]),
  dmLoad: v({ name: '', messages: [] }),
  dmSave: v(undefined),
  dmSignalSend: e(SEM_CONTA),
  dmSignals: v([]),
  dmRetencao: v(undefined),
  dmImagemSalvar: v(false),
  dmImagemLer: v(null),
  dmExportar: v([]),
  dmImportar: v(0),

  // Base que já funciona na Fase 0 sem depender do nativo
  youtubePrevia: v(null), // Fase 1: busca com o fetch nativo (a WebView não pode por causa do CORS)
};

const copia = (x) => (x && typeof x === 'object' ? JSON.parse(JSON.stringify(x)) : x);

export function criarStub(nome, [tipo, dado]) {
  if (tipo === 'evento') return () => undefined;
  if (tipo === 'erro') return () => Promise.reject(new Error(dado));
  return () => Promise.resolve(copia(dado));
}
