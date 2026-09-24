// audiocap.exe - captura o som do Windows ignorando um ou mais aplicativos.
// Usa a API "process loopback" do Windows 10 2004+ / Windows 11.
//
//   audiocap.exe --list                          lista os apps que estão usando áudio, um por linha:
//                                                "Discord.exe<TAB>Discord" (exe e nome amigável)
//   audiocap.exe --boost above 1234              deixa o processo 1234 e os filhos com prioridade
//                                                acima do normal (ou normal / high) e sem modo de eficiência
//   audiocap.exe --exclude-pid 1234              todo o som, menos o processo 1234 e os filhos dele
//   audiocap.exe --exclude-pid 1234 --exclude Discord.exe --exclude Spotify.exe
//                                                todo o som, menos o processo 1234 e esses apps
//
// Só com --exclude-pid, o próprio Windows tira aquele processo do som ("excluir árvore").
// Com apps pelo nome, o Windows não sabe ignorar mais de um processo de uma vez. Então
// capturamos cada app que está tocando som em separado ("incluir árvore"), menos os ignorados,
// e misturamos aqui. A lista é refeita a cada 1,5 s, então apps abertos depois também entram
// (ou ficam de fora, se forem ignorados).
//
// Saída: PCM 16 bits, estéreo, 48 kHz no stdout. Mensagens no stderr (READY / ERROR ...).
// Encerra sozinho quando o stdin é fechado (o app principal fechou).

#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <initguid.h>
#include <mmdeviceapi.h>
#include <audioclient.h>
#include <audiopolicy.h>
#include <tlhelp32.h>
#include <shellapi.h>
#include <algorithm>
#include <cstdint>
#include <cstdio>
#include <cwchar>
#include <map>
#include <memory>
#include <set>
#include <string>
#include <vector>

// ---- Definições de audioclientactivationparams.h (nem todo SDK traz) ----
enum ACT_TYPE { ACT_DEFAULT = 0, ACT_PROCESS_LOOPBACK = 1 };
enum LB_MODE { LB_INCLUDE_TREE = 0, LB_EXCLUDE_TREE = 1 };
struct LB_PARAMS { DWORD TargetProcessId; LB_MODE ProcessLoopbackMode; };
struct ACT_PARAMS { ACT_TYPE ActivationType; LB_PARAMS ProcessLoopbackParams; };

#ifndef CREATE_WAITABLE_TIMER_HIGH_RESOLUTION
#define CREATE_WAITABLE_TIMER_HIGH_RESOLUTION 0x00000002
#endif

static const IID IID_IAgileObject_ = { 0x94ea2b94, 0xe9cc, 0x49e0, { 0xc0, 0xff, 0xee, 0x64, 0xca, 0x8f, 0x5b, 0x90 } };

typedef HRESULT (WINAPI *ActivateFn)(LPCWSTR, REFIID, PROPVARIANT *, IActivateAudioInterfaceCompletionHandler *,
                                     IActivateAudioInterfaceAsyncOperation **);
typedef HANDLE (WINAPI *AvSetMmThreadFn)(LPCWSTR, LPDWORD);

static const UINT32 RATE = 48000;
static const REFERENCE_TIME BUFFER_HNS = 1000000;  // 100 ms de folga, caso o PC engasgue com um jogo pesado

static void logLine(const char *s) { fprintf(stderr, "%s\n", s); fflush(stderr); }

static std::string utf8(const std::wstring &w) {
  if (w.empty()) return {};
  int n = WideCharToMultiByte(CP_UTF8, 0, w.c_str(), (int)w.size(), nullptr, 0, nullptr, nullptr);
  std::string s(n, '\0');
  WideCharToMultiByte(CP_UTF8, 0, w.c_str(), (int)w.size(), &s[0], n, nullptr, nullptr);
  return s;
}

static void writeOut(const void *data, DWORD bytes) {
  static HANDLE out = GetStdHandle(STD_OUTPUT_HANDLE);
  DWORD written = 0;
  if (!WriteFile(out, data, bytes, &written, nullptr)) ExitProcess(0);  // o app fechou o pipe
}

// Dá ao thread de áudio a prioridade de áudio do Windows (MMCSS), para o som não picotar durante jogos
static void boostAudioThread() {
  HMODULE avrt = LoadLibraryW(L"avrt.dll");
  auto fn = avrt ? (AvSetMmThreadFn)GetProcAddress(avrt, "AvSetMmThreadCharacteristicsW") : nullptr;
  DWORD task = 0;
  if (!fn || !fn(L"Audio", &task)) SetThreadPriority(GetCurrentThread(), THREAD_PRIORITY_HIGHEST);
}

// ---- Processos ----
struct Proc { DWORD ppid; std::wstring name; };

class ProcTable {
  std::map<DWORD, Proc> procs;
  std::map<DWORD, ULONGLONG> born;

 public:
  ProcTable() {
    HANDLE snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
    if (snap == INVALID_HANDLE_VALUE) return;
    PROCESSENTRY32W pe = { sizeof(pe) };
    if (Process32FirstW(snap, &pe)) {
      do { procs[pe.th32ProcessID] = { pe.th32ParentProcessID, pe.szExeFile }; } while (Process32NextW(snap, &pe));
    }
    CloseHandle(snap);
  }

  const std::map<DWORD, Proc> &all() const { return procs; }

  const Proc *get(DWORD pid) const {
    auto it = procs.find(pid);
    return it == procs.end() ? nullptr : &it->second;
  }

  ULONGLONG created(DWORD pid) {
    auto it = born.find(pid);
    if (it != born.end()) return it->second;
    ULONGLONG t = 0;
    if (HANDLE h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid)) {
      FILETIME c, e, k, u;
      if (GetProcessTimes(h, &c, &e, &k, &u)) t = ((ULONGLONG)c.dwHighDateTime << 32) | c.dwLowDateTime;
      CloseHandle(h);
    }
    return born[pid] = t;
  }

  // O pai de verdade: o Windows reaproveita PIDs, então o ppid só vale se o pai nasceu antes do filho
  DWORD parentOf(DWORD pid) {
    const Proc *p = get(pid);
    if (!p || !p->ppid || p->ppid == pid || !get(p->ppid)) return 0;
    ULONGLONG a = created(p->ppid), b = created(pid);
    return (a && b && a > b) ? 0 : p->ppid;
  }
};

struct Exclusions {
  std::vector<std::wstring> names;
  std::set<DWORD> pids;

  bool matches(const ProcTable &t, DWORD pid) const {
    if (pids.count(pid)) return true;
    const Proc *p = t.get(pid);
    if (!p) return false;
    for (auto &n : names) if (_wcsicmp(n.c_str(), p->name.c_str()) == 0) return true;
    return false;
  }

  // true se o processo ou algum ancestral dele é ignorado
  bool covers(ProcTable &t, DWORD pid) const {
    for (int depth = 0; pid && depth < 64; depth++, pid = t.parentOf(pid))
      if (matches(t, pid)) return true;
    return false;
  }
};

// PIDs com sessão de áudio em qualquer saída ativa
static std::set<DWORD> audioSessionPids() {
  std::set<DWORD> pids;
  IMMDeviceEnumerator *en = nullptr;
  if (FAILED(CoCreateInstance(__uuidof(MMDeviceEnumerator), nullptr, CLSCTX_ALL, __uuidof(IMMDeviceEnumerator), (void **)&en)))
    return pids;
  IMMDeviceCollection *devs = nullptr;
  if (SUCCEEDED(en->EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE, &devs))) {
    UINT count = 0;
    devs->GetCount(&count);
    for (UINT d = 0; d < count; d++) {
      IMMDevice *dev = nullptr;
      if (FAILED(devs->Item(d, &dev))) continue;
      IAudioSessionManager2 *mgr = nullptr;
      if (SUCCEEDED(dev->Activate(__uuidof(IAudioSessionManager2), CLSCTX_ALL, nullptr, (void **)&mgr))) {
        IAudioSessionEnumerator *sessions = nullptr;
        if (SUCCEEDED(mgr->GetSessionEnumerator(&sessions))) {
          int n = 0;
          sessions->GetCount(&n);
          for (int i = 0; i < n; i++) {
            IAudioSessionControl *ctl = nullptr;
            if (FAILED(sessions->GetSession(i, &ctl))) continue;
            IAudioSessionControl2 *ctl2 = nullptr;
            if (SUCCEEDED(ctl->QueryInterface(__uuidof(IAudioSessionControl2), (void **)&ctl2))) {
              DWORD pid = 0;
              if (ctl2->IsSystemSoundsSession() != S_OK && ctl2->GetProcessId(&pid) == S_OK && pid) pids.insert(pid);
              ctl2->Release();
            }
            ctl->Release();
          }
          sessions->Release();
        }
        mgr->Release();
      }
      dev->Release();
    }
    devs->Release();
  }
  en->Release();
  return pids;
}

// ---- --list: apps com sessão de áudio ----
typedef DWORD (WINAPI *VerSizeFn)(LPCWSTR, LPDWORD);
typedef BOOL (WINAPI *VerInfoFn)(LPCWSTR, DWORD, DWORD, LPVOID);
typedef BOOL (WINAPI *VerQueryFn)(LPCVOID, LPCWSTR, LPVOID *, PUINT);

// Só as letras, em minúsculas: "Hunt: Showdown" -> "huntshowdown"
static std::wstring letters(const std::wstring &s) {
  std::wstring out;
  for (wchar_t c : s) if (iswalpha(c)) out += towlower(c);
  return out;
}

// Tamanho do maior pedaço em comum entre dois textos (diz o quanto um nome lembra o outro)
static size_t commonRun(const std::wstring &a, const std::wstring &b) {
  size_t best = 0;
  for (size_t i = 0; i < a.size(); i++)
    for (size_t j = 0; j < b.size(); j++) {
      size_t k = 0;
      while (i + k < a.size() && j + k < b.size() && a[i + k] == b[j + k]) k++;
      best = std::max(best, k);
    }
  return best;
}

// Nome amigável do programa, a "Descrição do arquivo" do .exe (ex.: wallpaper64.exe -> Wallpaper Engine).
// Usa o nome do produto quando ele lembra mais o .exe (ex.: Stremio, cuja descrição é um slogan), e o
// próprio nome do .exe quando nenhum dos dois lembra (ex.: HuntGame.exe, descrito como "WindowsLauncher").
static std::wstring friendlyName(DWORD pid, const std::wstring &exe) {
  static HMODULE ver = LoadLibraryW(L"version.dll");
  static auto verSize = ver ? (VerSizeFn)GetProcAddress(ver, "GetFileVersionInfoSizeW") : nullptr;
  static auto verInfo = ver ? (VerInfoFn)GetProcAddress(ver, "GetFileVersionInfoW") : nullptr;
  static auto verQuery = ver ? (VerQueryFn)GetProcAddress(ver, "VerQueryValueW") : nullptr;
  if (!verSize || !verInfo || !verQuery) return {};

  wchar_t path[MAX_PATH * 2];
  DWORD len = MAX_PATH * 2;
  HANDLE h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
  if (!h) return {};
  BOOL ok = QueryFullProcessImageNameW(h, 0, path, &len);
  CloseHandle(h);
  if (!ok) return {};

  DWORD unused = 0, size = verSize(path, &unused);
  if (!size) return {};
  std::vector<BYTE> buf(size);
  if (!verInfo(path, 0, size, buf.data())) return {};

  std::vector<std::wstring> tables;
  struct LangCp { WORD lang, cp; } *tr = nullptr;
  UINT trLen = 0;
  if (verQuery(buf.data(), L"\\VarFileInfo\\Translation", (LPVOID *)&tr, &trLen) && tr && trLen >= sizeof(LangCp)) {
    wchar_t key[64];
    _snwprintf(key, 64, L"\\StringFileInfo\\%04x%04x\\", tr[0].lang, tr[0].cp);
    tables.push_back(key);
  }
  tables.push_back(L"\\StringFileInfo\\040904b0\\");
  tables.push_back(L"\\StringFileInfo\\040904e4\\");

  auto lookup = [&](const wchar_t *field) -> std::wstring {
    for (auto &table : tables) {
      wchar_t *val = nullptr;
      UINT vlen = 0;
      if (!verQuery(buf.data(), (table + field).c_str(), (LPVOID *)&val, &vlen) || !val || vlen <= 1) continue;
      std::wstring s(val);
      size_t a = s.find_first_not_of(L" \t"), b = s.find_last_not_of(L" \t");
      if (a != std::wstring::npos) return s.substr(a, std::min<size_t>(b - a + 1, 40));
    }
    return {};
  };
  std::wstring desc = lookup(L"FileDescription"), product = lookup(L"ProductName");
  std::wstring base = exe.substr(0, exe.rfind(L'.'));
  std::wstring stem = letters(base);  // "wallpaper64.exe" -> "wallpaper"
  if (stem.size() <= 3) return desc.empty() ? product : desc;  // nomes curtos (cs2, vlc): confia na descrição

  size_t sd = commonRun(stem, letters(desc)), sp = commonRun(stem, letters(product));
  if (std::max(sd, sp) < 3) return base;
  return sp > sd ? product : desc;
}

static int listAudioApps() {
  ProcTable t;
  std::map<std::wstring, std::wstring> apps;  // exe -> nome amigável
  for (DWORD pid : audioSessionPids()) {
    const Proc *p = t.get(pid);
    if (!p) continue;
    std::wstring &name = apps[p->name];
    if (name.empty()) name = friendlyName(pid, p->name);
  }
  for (auto &kv : apps) printf("%s\t%s\n", utf8(kv.first).c_str(), utf8(kv.second).c_str());
  fflush(stdout);
  return 0;
}

// ---- Ativação assíncrona do "process loopback" ----
class Handler final : public IActivateAudioInterfaceCompletionHandler {
  LONG ref = 1;
  ~Handler() {
    if (client) client->Release();
    CloseHandle(done);
  }

 public:
  HANDLE done = CreateEventW(nullptr, TRUE, FALSE, nullptr);
  HRESULT hr = E_FAIL;
  IAudioClient *client = nullptr;

  ULONG STDMETHODCALLTYPE AddRef() override { return InterlockedIncrement(&ref); }
  ULONG STDMETHODCALLTYPE Release() override {
    LONG n = InterlockedDecrement(&ref);
    if (n == 0) delete this;
    return n;
  }
  HRESULT STDMETHODCALLTYPE QueryInterface(REFIID riid, void **out) override {
    if (riid == IID_IUnknown || riid == __uuidof(IActivateAudioInterfaceCompletionHandler) || riid == IID_IAgileObject_) {
      *out = this; AddRef(); return S_OK;
    }
    *out = nullptr; return E_NOINTERFACE;
  }
  HRESULT STDMETHODCALLTYPE ActivateCompleted(IActivateAudioInterfaceAsyncOperation *op) override {
    IUnknown *unk = nullptr;
    HRESULT activateHr = E_FAIL;
    hr = op->GetActivateResult(&activateHr, &unk);
    if (SUCCEEDED(hr)) hr = activateHr;
    if (SUCCEEDED(hr) && unk) hr = unk->QueryInterface(__uuidof(IAudioClient), (void **)&client);
    if (unk) unk->Release();
    SetEvent(done);
    return S_OK;
  }
};

static IAudioClient *activateLoopback(DWORD pid, LB_MODE mode, HRESULT &hr) {
  static ActivateFn activate = [] {
    HMODULE mod = LoadLibraryW(L"Mmdevapi.dll");
    return mod ? (ActivateFn)GetProcAddress(mod, "ActivateAudioInterfaceAsync") : (ActivateFn)nullptr;
  }();
  if (!activate) { hr = E_NOTIMPL; return nullptr; }

  ACT_PARAMS params = {};
  params.ActivationType = ACT_PROCESS_LOOPBACK;
  params.ProcessLoopbackParams.TargetProcessId = pid;
  params.ProcessLoopbackParams.ProcessLoopbackMode = mode;

  PROPVARIANT pv = {};
  pv.vt = VT_BLOB;
  pv.blob.cbSize = sizeof(params);
  pv.blob.pBlobData = (BYTE *)&params;

  // No heap e com contagem de referências: se a ativação demorar, o callback ainda encontra o objeto
  Handler *h = new Handler();
  IActivateAudioInterfaceAsyncOperation *op = nullptr;
  IAudioClient *client = nullptr;
  hr = activate(L"VAD\\Process_Loopback", __uuidof(IAudioClient), &pv, h, &op);
  if (SUCCEEDED(hr)) {
    if (WaitForSingleObject(h->done, 5000) == WAIT_OBJECT_0) {
      hr = h->hr;
      client = h->client;
      h->client = nullptr;
    } else {
      hr = HRESULT_FROM_WIN32(ERROR_TIMEOUT);
    }
  }
  if (op) op->Release();
  h->Release();
  if (FAILED(hr) && client) { client->Release(); client = nullptr; }
  return client;
}

// Um fluxo de captura já iniciado: 48 kHz, estéreo, 16 bits
class Stream {
  IAudioClient *client = nullptr;
  IAudioCaptureClient *cap = nullptr;

 public:
  HANDLE ev = nullptr;

  Stream() = default;
  Stream(const Stream &) = delete;
  Stream &operator=(const Stream &) = delete;
  ~Stream() {
    if (client) client->Stop();
    if (cap) cap->Release();
    if (client) client->Release();
    if (ev) CloseHandle(ev);
  }

  HRESULT open(DWORD pid, LB_MODE mode) {
    HRESULT hr;
    client = activateLoopback(pid, mode, hr);
    if (!client) return FAILED(hr) ? hr : E_FAIL;

    WAVEFORMATEX fmt = {};
    fmt.wFormatTag = WAVE_FORMAT_PCM;
    fmt.nChannels = 2;
    fmt.nSamplesPerSec = RATE;
    fmt.wBitsPerSample = 16;
    fmt.nBlockAlign = 4;
    fmt.nAvgBytesPerSec = RATE * 4;

    hr = client->Initialize(AUDCLNT_SHAREMODE_SHARED,
                            AUDCLNT_STREAMFLAGS_LOOPBACK | AUDCLNT_STREAMFLAGS_EVENTCALLBACK | AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM,
                            BUFFER_HNS, 0, &fmt, nullptr);
    if (FAILED(hr)) return hr;
    ev = CreateEventW(nullptr, FALSE, FALSE, nullptr);
    if (FAILED(hr = client->SetEventHandle(ev))) return hr;
    if (FAILED(hr = client->GetService(__uuidof(IAudioCaptureClient), (void **)&cap))) return hr;
    return client->Start();
  }

  // Entrega cada pacote que chegou (nullptr = silêncio). false = o fluxo quebrou.
  template <class F> bool drain(F &&onPacket) {
    UINT32 packet = 0;
    HRESULT hr;
    while (SUCCEEDED(hr = cap->GetNextPacketSize(&packet)) && packet > 0) {
      BYTE *data = nullptr;
      UINT32 frames = 0;
      DWORD flags = 0;
      if (FAILED(hr = cap->GetBuffer(&data, &frames, &flags, nullptr, nullptr))) return false;
      onPacket((flags & AUDCLNT_BUFFERFLAGS_SILENT) ? nullptr : (const int16_t *)data, frames);
      cap->ReleaseBuffer(frames);
    }
    return SUCCEEDED(hr);
  }
};

// ---- Um processo só: o Windows tira ele (e os filhos) do som de todo o PC ----
static int captureExcluding(DWORD pid) {
  Stream s;
  HRESULT hr = s.open(pid, LB_EXCLUDE_TREE);
  if (FAILED(hr)) { fprintf(stderr, "ERROR captura falhou 0x%08lx (precisa Windows 10 2004 ou mais novo)\n", hr); return 3; }
  boostAudioThread();
  logLine("READY");

  std::vector<int16_t> zeros;
  for (;;) {
    WaitForSingleObject(s.ev, 1000);
    bool ok = s.drain([&](const int16_t *pcm, UINT32 frames) {
      if (!pcm) {
        if (zeros.size() < frames * 2) zeros.assign(frames * 2, 0);
        pcm = zeros.data();
      }
      writeOut(pcm, frames * 4);
    });
    if (!ok) { logLine("ERROR a captura parou"); return 4; }
  }
}

// ---- Vários apps: um fluxo "incluir árvore" por app que está tocando som, misturados aqui ----
static const UINT32 RING = RATE;          // 1 s guardado por app
static const UINT32 PRIME = RATE / 50;    // 20 ms guardados antes de um app entrar na mistura
static const UINT32 HIGH = RATE / 10;     // mais de 100 ms guardados: descarta o excesso (o atraso não cresce)
static const UINT32 MAX_TICK = RATE / 10; // no máximo 100 ms por rodada, mesmo se o PC travar

struct Source {
  Stream stream;
  ULONGLONG born = 0;
  std::vector<int16_t> ring = std::vector<int16_t>(RING * 2);
  UINT32 r = 0, w = 0, avail = 0;
  bool primed = false;

  void push(const int16_t *pcm, UINT32 frames) {
    for (UINT32 i = 0; i < frames; i++) {
      ring[w * 2] = pcm ? pcm[i * 2] : 0;
      ring[w * 2 + 1] = pcm ? pcm[i * 2 + 1] : 0;
      w = (w + 1) % RING;
    }
    avail += frames;
    if (avail > RING) { r = w; avail = RING; }
  }

  void mixInto(std::vector<int32_t> &acc, UINT32 frames) {
    if (!primed) {
      if (avail < PRIME) return;
      primed = true;
    }
    UINT32 n = std::min(avail, frames);
    for (UINT32 i = 0; i < n; i++) {
      acc[i * 2] += ring[r * 2];
      acc[i * 2 + 1] += ring[r * 2 + 1];
      r = (r + 1) % RING;
    }
    avail -= n;
    if (n < frames) primed = false;  // o app parou de mandar som: espera encher de novo
    else if (avail > HIGH) {
      UINT32 drop = avail - PRIME;
      r = (r + drop) % RING;
      avail -= drop;
    }
  }
};

static int captureMixing(const Exclusions &ex) {
  const DWORD self = GetCurrentProcessId();

  // Confere se o Windows tem a captura por aplicativo antes de dizer que está pronto
  {
    Stream probe;
    HRESULT hr = probe.open(self, LB_EXCLUDE_TREE);
    if (FAILED(hr)) { fprintf(stderr, "ERROR captura falhou 0x%08lx (precisa Windows 10 2004 ou mais novo)\n", hr); return 3; }
  }

  std::map<DWORD, std::unique_ptr<Source>> sources;
  std::map<DWORD, ULONGLONG> failed;  // apps que o Windows não deixou capturar: não tenta de novo

  auto rescan = [&] {
    ProcTable t;
    // Quem tem um app ignorado entre os descendentes não pode entrar com a árvore inteira
    std::set<DWORD> blocked;
    for (auto &kv : t.all()) {
      if (!ex.matches(t, kv.first)) continue;
      DWORD a = t.parentOf(kv.first);
      for (int d = 0; a && d < 64; d++, a = t.parentOf(a)) blocked.insert(a);
    }
    std::set<DWORD> cand;
    for (DWORD pid : audioSessionPids())
      if (pid != self && t.get(pid) && !ex.covers(t, pid)) cand.insert(pid);
    std::set<DWORD> want;
    for (DWORD pid : cand) {
      if (blocked.count(pid)) continue;
      bool inside = false;  // um ancestral já vai ser capturado junto com os filhos
      DWORD a = t.parentOf(pid);
      for (int d = 0; a && d < 64 && !inside; d++, a = t.parentOf(a)) inside = cand.count(a) && !blocked.count(a);
      if (!inside) want.insert(pid);
    }

    for (auto it = sources.begin(); it != sources.end();) {
      bool keep = want.count(it->first) && t.created(it->first) == it->second->born;
      it = keep ? std::next(it) : sources.erase(it);
    }
    for (auto it = failed.begin(); it != failed.end();)
      it = (t.get(it->first) && t.created(it->first) == it->second) ? std::next(it) : failed.erase(it);

    for (DWORD pid : want) {
      if (sources.count(pid) || failed.count(pid)) continue;
      auto src = std::make_unique<Source>();
      src->born = t.created(pid);
      HRESULT hr = src->stream.open(pid, LB_INCLUDE_TREE);
      std::string name = utf8(t.get(pid)->name);
      if (FAILED(hr)) {
        fprintf(stderr, "INFO nao deu para capturar %s (%lu): 0x%08lx\n", name.c_str(), pid, hr);
        failed[pid] = src->born;
        continue;
      }
      fprintf(stderr, "INFO capturando %s (%lu)\n", name.c_str(), pid);
      sources[pid] = std::move(src);
    }
    fflush(stderr);
  };

  rescan();
  boostAudioThread();
  HANDLE timer = CreateWaitableTimerExW(nullptr, nullptr, CREATE_WAITABLE_TIMER_HIGH_RESOLUTION, TIMER_ALL_ACCESS);
  if (!timer) timer = CreateWaitableTimerW(nullptr, FALSE, nullptr);

  LARGE_INTEGER freq, t0, now;
  QueryPerformanceFrequency(&freq);
  QueryPerformanceCounter(&t0);
  LONGLONG produced = 0;
  LONGLONG nextScan = t0.QuadPart + freq.QuadPart * 3 / 2;
  std::vector<int32_t> acc;
  std::vector<int16_t> pcm;
  logLine("READY");

  for (;;) {
    LARGE_INTEGER wait;
    wait.QuadPart = -100000;  // 10 ms
    if (timer && SetWaitableTimer(timer, &wait, 0, nullptr, nullptr, FALSE)) WaitForSingleObject(timer, 100);
    else Sleep(10);

    for (auto it = sources.begin(); it != sources.end();) {
      Source &s = *it->second;
      bool ok = s.stream.drain([&](const int16_t *p, UINT32 frames) { s.push(p, frames); });
      it = ok ? std::next(it) : sources.erase(it);  // o fluxo quebrou: a próxima varredura tenta de novo
    }

    // Manda exatamente 48 000 quadros por segundo, pelo relógio do PC, mesmo sem nenhum app tocando
    QueryPerformanceCounter(&now);
    LONGLONG target = (now.QuadPart - t0.QuadPart) * RATE / freq.QuadPart;
    LONGLONG frames = target - produced;
    if (frames > MAX_TICK) { produced = target - MAX_TICK; frames = MAX_TICK; }
    if (frames > 0) {
      acc.assign(frames * 2, 0);
      for (auto &kv : sources) kv.second->mixInto(acc, (UINT32)frames);
      pcm.resize(acc.size());
      for (size_t i = 0; i < acc.size(); i++) pcm[i] = (int16_t)std::clamp(acc[i], -32768, 32767);
      writeOut(pcm.data(), (DWORD)(frames * 4));
      produced += frames;
    }

    if (now.QuadPart >= nextScan) {
      rescan();
      QueryPerformanceCounter(&now);
      nextScan = now.QuadPart + freq.QuadPart * 3 / 2;
    }
  }
}

// ---- --boost: prioridade do app inteiro ----
// Com a janela em segundo plano, o Windows e o Chromium jogam processos para prioridade ociosa e
// modo de eficiência (núcleos lentos). Aqui cada processo do app (o raiz e todos os filhos) fica
// com a prioridade escolhida e com o modo de eficiência desligado. Refaz a cada 2 s, porque o
// Chromium abre processos novos e às vezes mexe na prioridade deles.
struct PowerThrottling { ULONG Version, ControlMask, StateMask; };
typedef BOOL (WINAPI *SetProcInfoFn)(HANDLE, int, LPVOID, DWORD);
static const int PROCESS_POWER_THROTTLING_CLASS = 4;  // ProcessPowerThrottling
static const ULONG THROTTLE_EXECUTION_SPEED = 0x1, THROTTLE_IGNORE_TIMER_RESOLUTION = 0x4;

static int boost(const wchar_t *level, DWORD root) {
  DWORD cls = NORMAL_PRIORITY_CLASS;
  if (wcscmp(level, L"above") == 0) cls = ABOVE_NORMAL_PRIORITY_CLASS;
  else if (wcscmp(level, L"high") == 0) cls = HIGH_PRIORITY_CLASS;
  auto setInfo = (SetProcInfoFn)GetProcAddress(GetModuleHandleW(L"kernel32.dll"), "SetProcessInformation");

  for (;;) {
    ProcTable t;
    for (auto &kv : t.all()) {
      // Primeiro um teste rápido pelo ppid; só confirma (com a data de criação) quem parece ser do app
      bool maybe = false;
      DWORD a = kv.first;
      for (int d = 0; a && d < 64 && !maybe; d++) { maybe = a == root; const Proc *p = t.get(a); a = p ? p->ppid : 0; }
      if (!maybe) continue;
      bool inTree = false;
      a = kv.first;
      for (int d = 0; a && d < 64 && !inTree; d++) { inTree = a == root; a = t.parentOf(a); }
      if (!inTree) continue;

      HANDLE h = OpenProcess(PROCESS_SET_INFORMATION | PROCESS_QUERY_LIMITED_INFORMATION, FALSE, kv.first);
      if (!h) continue;
      if (GetPriorityClass(h) != cls) SetPriorityClass(h, cls);
      if (setInfo) {
        PowerThrottling off = { 1, THROTTLE_EXECUTION_SPEED | THROTTLE_IGNORE_TIMER_RESOLUTION, 0 };
        if (!setInfo(h, PROCESS_POWER_THROTTLING_CLASS, &off, sizeof(off))) {
          off.ControlMask = THROTTLE_EXECUTION_SPEED;  // Windows 10 não conhece a opção do timer
          setInfo(h, PROCESS_POWER_THROTTLING_CLASS, &off, sizeof(off));
        }
      }
      CloseHandle(h);
    }
    Sleep(2000);
  }
}

static DWORD WINAPI watchStdin(LPVOID) {
  char buf[64];
  DWORD n;
  HANDLE in = GetStdHandle(STD_INPUT_HANDLE);
  while (ReadFile(in, buf, sizeof(buf), &n, nullptr) && n > 0) {}
  ExitProcess(0);
  return 0;
}

int main() {
  int argc = 0;
  wchar_t **argv = CommandLineToArgvW(GetCommandLineW(), &argc);
  CoInitializeEx(nullptr, COINIT_MULTITHREADED);

  if (argc >= 2 && wcscmp(argv[1], L"--list") == 0) return listAudioApps();

  if (argc >= 4 && wcscmp(argv[1], L"--boost") == 0) {
    CreateThread(nullptr, 0, watchStdin, nullptr, 0, nullptr);  // termina junto com o app
    return boost(argv[2], wcstoul(argv[3], nullptr, 10));
  }

  Exclusions ex;
  for (int i = 1; i + 1 < argc; i += 2) {
    if (wcscmp(argv[i], L"--exclude") == 0) ex.names.push_back(argv[i + 1]);
    else if (wcscmp(argv[i], L"--exclude-pid") == 0) {
      DWORD pid = wcstoul(argv[i + 1], nullptr, 10);
      if (pid) ex.pids.insert(pid);
    }
  }
  if (ex.names.empty() && ex.pids.empty()) {
    logLine("uso: audiocap.exe --list | --exclude-pid <pid> [--exclude <app.exe> ...]");
    return 1;
  }

  CreateThread(nullptr, 0, watchStdin, nullptr, 0, nullptr);
  if (ex.names.empty() && ex.pids.size() == 1) return captureExcluding(*ex.pids.begin());
  return captureMixing(ex);
}
