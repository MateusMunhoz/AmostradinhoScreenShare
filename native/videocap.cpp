// videocap.exe - captura a tela (ou uma janela) e codifica em H.264 direto no NVENC da placa NVIDIA.
// A imagem não sai da placa: captura do Windows (Windows.Graphics.Capture) -> escala e conversão
// para NV12 pelo processador de vídeo do D3D11 -> NVENC.
//
//   videocap.exe --probe                          uma linha JSON: {"nvenc":true,"gpu":"..."} ou {"nvenc":false,"error":"..."}
//   videocap.exe --monitor X,Y [opções]           a tela que contém o ponto X,Y (pixels físicos)
//   videocap.exe --window HWND [opções]           uma janela
//   opções: --width 1920 --height 1080 --fps 60 --bitrate 7000000 (tamanho máximo; a proporção da imagem é mantida)
//
// Saída (stdout): um quadro por vez, [tamanho u32][chave u8][timestamp f64 em µs][H.264 Annex B].
// Mensagens (stderr): READY <largura> <altura> | ERROR <texto> | ENDED (a janela fechou) |
//                     STATS <quadros capturados> <quadros codificados> (totais, a cada segundo).
// Comandos (stdin, uma linha cada): key | bitrate N | pause | resume. Fechar o stdin encerra.
// A prioridade (processador e placa de vídeo) vem do "audiocap --boost", que cuida de todos os
// processos do app, este incluído.

#define WIN32_LEAN_AND_MEAN
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#include <d3d11_4.h>
#include <dxgi1_2.h>
#include <shellapi.h>
#include <windows.graphics.capture.interop.h>
#include <windows.graphics.directx.direct3d11.interop.h>
#include <winrt/Windows.Foundation.h>
#include <winrt/Windows.Foundation.Metadata.h>
#include <winrt/Windows.Graphics.Capture.h>
#include <winrt/Windows.Graphics.DirectX.Direct3D11.h>
#include <atomic>
#include <cstdint>
#include <cstdio>
#include <string>
#include <vector>
#include "third_party/nvEncodeAPI.h"

using namespace winrt;
using namespace winrt::Windows::Graphics::Capture;
using namespace winrt::Windows::Graphics::DirectX;
using namespace winrt::Windows::Graphics::DirectX::Direct3D11;

static void logLine(const char *s) { fprintf(stderr, "%s\n", s); fflush(stderr); }

[[noreturn]] static void fail(const std::string &msg) {
  logLine(("ERROR " + msg).c_str());
  ExitProcess(1);
}

static std::string utf8(const std::wstring &w) {
  if (w.empty()) return {};
  int n = WideCharToMultiByte(CP_UTF8, 0, w.c_str(), (int)w.size(), nullptr, 0, nullptr, nullptr);
  std::string s(n, '\0');
  WideCharToMultiByte(CP_UTF8, 0, w.c_str(), (int)w.size(), s.data(), n, nullptr, nullptr);
  return s;
}

static std::string hex(long v) {
  char b[16];
  snprintf(b, sizeof(b), "0x%08lX", (unsigned long)v);
  return b;
}

#define HR(x, what) do { HRESULT hr_ = (x); if (FAILED(hr_)) fail(std::string(what) + " (" + hex(hr_) + ")"); } while (0)
#define NV(x, what) do { NVENCSTATUS st_ = (x); if (st_ != NV_ENC_SUCCESS) fail(std::string(what) + " (NVENC " + std::to_string((int)st_) + ")"); } while (0)

template <class T> struct Com {
  T *p = nullptr;
  ~Com() { if (p) p->Release(); }
  T **put() { if (p) { p->Release(); p = nullptr; } return &p; }
  T *operator->() const { return p; }
  operator T *() const { return p; }
};

// ---------- Placa de vídeo e NVENC ----------
struct Gpu {
  Com<ID3D11Device> dev;
  Com<ID3D11DeviceContext> ctx;
  std::wstring name;
};

// Dispositivo D3D11 na placa NVIDIA (em notebook com duas placas, a da NVIDIA, que tem o NVENC)
static bool createNvidiaDevice(Gpu &g, std::string &err) {
  Com<IDXGIFactory1> factory;
  if (FAILED(CreateDXGIFactory1(__uuidof(IDXGIFactory1), (void **)factory.put()))) { err = "DXGI indisponível"; return false; }
  Com<IDXGIAdapter1> adapter;
  for (UINT i = 0; factory->EnumAdapters1(i, adapter.put()) != DXGI_ERROR_NOT_FOUND; i++) {
    DXGI_ADAPTER_DESC1 d;
    adapter->GetDesc1(&d);
    if (d.VendorId != 0x10DE) continue;
    D3D_FEATURE_LEVEL fl;
    HRESULT hr = D3D11CreateDevice(adapter, D3D_DRIVER_TYPE_UNKNOWN, nullptr,
                                   D3D11_CREATE_DEVICE_BGRA_SUPPORT | D3D11_CREATE_DEVICE_VIDEO_SUPPORT,
                                   nullptr, 0, D3D11_SDK_VERSION, g.dev.put(), &fl, g.ctx.put());
    if (FAILED(hr)) { err = "não foi possível usar a placa NVIDIA (" + hex(hr) + ")"; return false; }
    g.name = d.Description;
    // A captura chega por outra thread do Windows: o contexto precisa aceitar isso
    Com<ID3D11Multithread> mt;
    if (SUCCEEDED(g.ctx->QueryInterface(__uuidof(ID3D11Multithread), (void **)mt.put()))) mt->SetMultithreadProtected(TRUE);
    return true;
  }
  err = "nenhuma placa NVIDIA";
  return false;
}

typedef NVENCSTATUS (NVENCAPI *CreateInstanceFn)(NV_ENCODE_API_FUNCTION_LIST *);
typedef NVENCSTATUS (NVENCAPI *MaxVersionFn)(uint32_t *);

struct Nvenc {
  NV_ENCODE_API_FUNCTION_LIST fn = { NV_ENCODE_API_FUNCTION_LIST_VER };
  void *enc = nullptr;
};

static bool openNvenc(Nvenc &n, ID3D11Device *dev, std::string &err) {
  HMODULE lib = LoadLibraryW(L"nvEncodeAPI64.dll");
  if (!lib) { err = "o driver da NVIDIA não tem o NVENC (nvEncodeAPI64.dll)"; return false; }
  auto maxVersion = (MaxVersionFn)GetProcAddress(lib, "NvEncodeAPIGetMaxSupportedVersion");
  auto create = (CreateInstanceFn)GetProcAddress(lib, "NvEncodeAPICreateInstance");
  if (!maxVersion || !create) { err = "NVENC incompleto no driver"; return false; }
  uint32_t v = 0;
  maxVersion(&v);
  if (v < ((NVENCAPI_MAJOR_VERSION << 4) | NVENCAPI_MINOR_VERSION)) { err = "driver da NVIDIA antigo: atualize para a versão 522 ou mais nova"; return false; }
  if (create(&n.fn) != NV_ENC_SUCCESS) { err = "NVENC não abriu"; return false; }
  NV_ENC_OPEN_ENCODE_SESSION_EX_PARAMS p = { NV_ENC_OPEN_ENCODE_SESSION_EX_PARAMS_VER };
  p.device = dev;
  p.deviceType = NV_ENC_DEVICE_TYPE_DIRECTX;
  p.apiVersion = NVENCAPI_VERSION;
  NVENCSTATUS st = n.fn.nvEncOpenEncodeSessionEx(&p, &n.enc);
  if (st != NV_ENC_SUCCESS) { err = "NVENC recusou a sessão (" + std::to_string((int)st) + "), talvez outro programa esteja usando todas"; return false; }
  // Confere se a placa codifica H.264
  uint32_t count = 0;
  n.fn.nvEncGetEncodeGUIDCount(n.enc, &count);
  std::vector<GUID> guids(count);
  n.fn.nvEncGetEncodeGUIDs(n.enc, guids.data(), count, &count);
  for (auto &g : guids) if (IsEqualGUID(g, NV_ENC_CODEC_H264_GUID)) return true;
  err = "esta placa não codifica H.264";
  return false;
}

static int probe() {
  Gpu g;
  Nvenc n;
  std::string err;
  if (createNvidiaDevice(g, err) && openNvenc(n, g.dev, err)) {
    std::string name = utf8(g.name);
    for (auto &c : name) if (c == '"' || c == '\\') c = ' ';
    printf("{\"nvenc\":true,\"gpu\":\"%s\"}\n", name.c_str());
    n.fn.nvEncDestroyEncoder(n.enc);
  } else {
    for (auto &c : err) if (c == '"' || c == '\\') c = ' ';
    printf("{\"nvenc\":false,\"error\":\"%s\"}\n", err.c_str());
  }
  fflush(stdout);
  return 0;
}

// ---------- Comandos pelo stdin ----------
static std::atomic<bool> wantKey{ true };
static std::atomic<uint32_t> newBitrate{ 0 };
static std::atomic<bool> paused{ false };

static DWORD WINAPI readCommands(LPVOID) {
  HANDLE in = GetStdHandle(STD_INPUT_HANDLE);
  std::string line;
  char buf[256];
  DWORD n;
  while (ReadFile(in, buf, sizeof(buf), &n, nullptr) && n > 0) {
    for (DWORD i = 0; i < n; i++) {
      if (buf[i] == '\r') continue;
      if (buf[i] != '\n') { if (line.size() < 64) line += buf[i]; continue; }
      if (line == "key") wantKey = true;
      else if (line == "pause") paused = true;
      else if (line == "resume") { paused = false; wantKey = true; }
      else if (line.rfind("bitrate ", 0) == 0) newBitrate = (uint32_t)strtoul(line.c_str() + 8, nullptr, 10);
      line.clear();
    }
  }
  ExitProcess(0);  // o app fechou
  return 0;
}

static void writeAll(const void *data, DWORD bytes) {
  HANDLE out = GetStdHandle(STD_OUTPUT_HANDLE);
  const char *p = (const char *)data;
  while (bytes) {
    DWORD w = 0;
    if (!WriteFile(out, p, bytes, &w, nullptr) || !w) ExitProcess(0);  // o app fechou
    p += w;
    bytes -= w;
  }
}

static void writeFrame(const void *data, uint32_t size, bool key, double tsUs) {
  uint8_t head[13];
  memcpy(head, &size, 4);
  head[4] = key ? 1 : 0;
  memcpy(head + 5, &tsUs, 8);
  writeAll(head, sizeof(head));
  writeAll(data, size);
}

// ---------- Captura ----------
struct Options {
  HWND window = nullptr;
  POINT monitorPoint{};
  bool monitor = false;
  UINT maxW = 1920, maxH = 1080, fps = 60, bitrate = 7000000;
};

static GraphicsCaptureItem createItem(const Options &o) {
  auto interop = get_activation_factory<GraphicsCaptureItem, IGraphicsCaptureItemInterop>();
  GraphicsCaptureItem item{ nullptr };
  if (o.window) {
    if (!IsWindow(o.window)) fail("a janela não existe mais");
    HR(interop->CreateForWindow(o.window, guid_of<GraphicsCaptureItem>(), put_abi(item)), "não foi possível capturar esta janela");
  } else {
    HMONITOR mon = MonitorFromPoint(o.monitorPoint, MONITOR_DEFAULTTOPRIMARY);
    HR(interop->CreateForMonitor(mon, guid_of<GraphicsCaptureItem>(), put_abi(item)), "não foi possível capturar esta tela");
  }
  return item;
}

static UINT even(double v) { UINT n = (UINT)(v + 0.5); return n < 2 ? 2 : n & ~1u; }

// ---------- Programa principal ----------
static int run(const Options &o) {
  init_apartment(apartment_type::multi_threaded);
  if (!GraphicsCaptureSession::IsSupported()) fail("este Windows não tem a captura de tela moderna");

  Gpu g;
  Nvenc nv;
  std::string err;
  if (!createNvidiaDevice(g, err) || !openNvenc(nv, g.dev, err)) fail(err);

  // Dispositivo no formato que a captura do Windows pede
  Com<IDXGIDevice> dxgi;
  HR(g.dev->QueryInterface(__uuidof(IDXGIDevice), (void **)dxgi.put()), "DXGI");
  com_ptr<::IInspectable> insp;
  HR(CreateDirect3D11DeviceFromDXGIDevice(dxgi, insp.put()), "dispositivo da captura");
  IDirect3DDevice device = insp.as<IDirect3DDevice>();

  GraphicsCaptureItem item = createItem(o);
  auto size = item.Size();
  std::atomic<bool> ended{ false };
  item.Closed([&](auto &&, auto &&) { ended = true; });

  // Tamanho de saída: a proporção da captura, no máximo o tamanho pedido (sem aumentar)
  double scale = std::min(1.0, std::min((double)o.maxW / size.Width, (double)o.maxH / size.Height));
  const UINT W = even(size.Width * scale), H = even(size.Height * scale);

  auto pool = Direct3D11CaptureFramePool::CreateFreeThreaded(device, DirectXPixelFormat::B8G8R8A8UIntNormalized, 2, size);
  auto session = pool.CreateCaptureSession(item);
  try { session.IsCursorCaptureEnabled(true); } catch (...) {}
  try { session.IsBorderRequired(false); } catch (...) {}  // sem a borda amarela (Windows 11)
  try {
    if (winrt::Windows::Foundation::Metadata::ApiInformation::IsPropertyPresent(L"Windows.Graphics.Capture.GraphicsCaptureSession", L"MinUpdateInterval"))
      session.MinUpdateInterval(winrt::Windows::Foundation::TimeSpan{ 10'000'000 / o.fps });
  } catch (...) {}

  // Processador de vídeo do D3D11: escala e converte BGRA -> NV12 sem sair da placa
  Com<ID3D11VideoDevice> vdev;
  Com<ID3D11VideoContext> vctx;
  HR(g.dev->QueryInterface(__uuidof(ID3D11VideoDevice), (void **)vdev.put()), "processador de vídeo");
  HR(g.ctx->QueryInterface(__uuidof(ID3D11VideoContext), (void **)vctx.put()), "processador de vídeo");

  // Cópia da captura numa textura nossa (a do Windows nem sempre aceita ser lida pelo processador)
  Com<ID3D11Texture2D> bgra;
  UINT srcW = 0, srcH = 0;
  Com<ID3D11VideoProcessorEnumerator> vpEnum;
  Com<ID3D11VideoProcessor> vp;
  Com<ID3D11VideoProcessorInputView> inView;
  Com<ID3D11VideoProcessorOutputView> outView;

  D3D11_TEXTURE2D_DESC nd = {};
  nd.Width = W; nd.Height = H; nd.MipLevels = 1; nd.ArraySize = 1;
  nd.Format = DXGI_FORMAT_NV12; nd.SampleDesc.Count = 1;
  nd.Usage = D3D11_USAGE_DEFAULT; nd.BindFlags = D3D11_BIND_RENDER_TARGET;
  Com<ID3D11Texture2D> nv12;
  HR(g.dev->CreateTexture2D(&nd, nullptr, nv12.put()), "textura NV12");

  // Recria o processador quando o tamanho da captura muda (janela redimensionada)
  auto setupSource = [&](UINT w, UINT h) {
    D3D11_TEXTURE2D_DESC bd = {};
    bd.Width = w; bd.Height = h; bd.MipLevels = 1; bd.ArraySize = 1;
    bd.Format = DXGI_FORMAT_B8G8R8A8_UNORM; bd.SampleDesc.Count = 1;
    bd.Usage = D3D11_USAGE_DEFAULT; bd.BindFlags = D3D11_BIND_RENDER_TARGET | D3D11_BIND_SHADER_RESOURCE;
    HR(g.dev->CreateTexture2D(&bd, nullptr, bgra.put()), "textura da captura");

    D3D11_VIDEO_PROCESSOR_CONTENT_DESC cd = {};
    cd.InputFrameFormat = D3D11_VIDEO_FRAME_FORMAT_PROGRESSIVE;
    cd.InputWidth = w; cd.InputHeight = h; cd.OutputWidth = W; cd.OutputHeight = H;
    cd.InputFrameRate = { o.fps, 1 }; cd.OutputFrameRate = { o.fps, 1 };
    cd.Usage = D3D11_VIDEO_USAGE_OPTIMAL_SPEED;
    HR(vdev->CreateVideoProcessorEnumerator(&cd, vpEnum.put()), "processador de vídeo");
    HR(vdev->CreateVideoProcessor(vpEnum, 0, vp.put()), "processador de vídeo");

    D3D11_VIDEO_PROCESSOR_INPUT_VIEW_DESC iv = {};
    iv.ViewDimension = D3D11_VPIV_DIMENSION_TEXTURE2D;
    HR(vdev->CreateVideoProcessorInputView(bgra, vpEnum, &iv, inView.put()), "entrada do processador de vídeo");
    D3D11_VIDEO_PROCESSOR_OUTPUT_VIEW_DESC ov = {};
    ov.ViewDimension = D3D11_VPOV_DIMENSION_TEXTURE2D;
    HR(vdev->CreateVideoProcessorOutputView(nv12, vpEnum, &ov, outView.put()), "saída do processador de vídeo");

    // RGB da tela (0-255) -> vídeo BT.709 (16-235), o padrão que quem assiste espera
    D3D11_VIDEO_PROCESSOR_COLOR_SPACE in = {};
    in.RGB_Range = 0;  // 0-255
    D3D11_VIDEO_PROCESSOR_COLOR_SPACE out = {};
    out.YCbCr_Matrix = 1;  // BT.709
    out.Nominal_Range = D3D11_VIDEO_PROCESSOR_NOMINAL_RANGE_16_235;
    vctx->VideoProcessorSetStreamColorSpace(vp, 0, &in);
    vctx->VideoProcessorSetOutputColorSpace(vp, &out);
    vctx->VideoProcessorSetStreamFrameFormat(vp, 0, D3D11_VIDEO_FRAME_FORMAT_PROGRESSIVE);
    vctx->VideoProcessorSetStreamAutoProcessingMode(vp, 0, FALSE);

    // Mantém a proporção: se a janela mudar de formato, sobram faixas pretas
    double s = std::min((double)W / w, (double)H / h);
    UINT dw = even(w * s), dh = even(h * s);
    RECT dst = { (LONG)((W - dw) / 2) & ~1L, (LONG)((H - dh) / 2) & ~1L, 0, 0 };
    dst.right = dst.left + dw;
    dst.bottom = dst.top + dh;
    RECT src = { 0, 0, (LONG)w, (LONG)h };
    RECT full = { 0, 0, (LONG)W, (LONG)H };
    D3D11_VIDEO_COLOR black = {};
    black.YCbCr = { 16.0f / 255, 128.0f / 255, 128.0f / 255, 1.0f };
    vctx->VideoProcessorSetOutputBackgroundColor(vp, TRUE, &black);
    vctx->VideoProcessorSetOutputTargetRect(vp, TRUE, &full);
    vctx->VideoProcessorSetStreamSourceRect(vp, 0, TRUE, &src);
    vctx->VideoProcessorSetStreamDestRect(vp, 0, TRUE, &dst);
    srcW = w;
    srcH = h;
  };
  setupSource(size.Width, size.Height);

  // ---- NVENC: H.264 High, baixíssimo atraso, bitrate constante, sem B-frames ----
  NV_ENC_PRESET_CONFIG preset = { NV_ENC_PRESET_CONFIG_VER, { NV_ENC_CONFIG_VER } };
  NV(nv.fn.nvEncGetEncodePresetConfigEx(nv.enc, NV_ENC_CODEC_H264_GUID, NV_ENC_PRESET_P4_GUID,
                                        NV_ENC_TUNING_INFO_ULTRA_LOW_LATENCY, &preset), "configuração do NVENC");
  NV_ENC_CONFIG cfg = preset.presetCfg;
  cfg.version = NV_ENC_CONFIG_VER;
  cfg.profileGUID = NV_ENC_H264_PROFILE_HIGH_GUID;
  cfg.gopLength = NVENC_INFINITE_GOPLENGTH;  // quadro-chave só quando alguém pede
  cfg.frameIntervalP = 1;
  auto setBitrate = [&](uint32_t bps) {
    cfg.rcParams.rateControlMode = NV_ENC_PARAMS_RC_CBR;
    cfg.rcParams.averageBitRate = bps;
    cfg.rcParams.maxBitRate = bps;
    cfg.rcParams.vbvBufferSize = bps / o.fps;  // um quadro: nenhum quadro sai muito maior que a média
    cfg.rcParams.vbvInitialDelay = bps / o.fps;
  };
  setBitrate(o.bitrate);
  auto &h264 = cfg.encodeCodecConfig.h264Config;
  h264.idrPeriod = NVENC_INFINITE_GOPLENGTH;
  h264.repeatSPSPPS = 1;
  h264.level = NV_ENC_LEVEL_AUTOSELECT;
  h264.h264VUIParameters.videoSignalTypePresentFlag = 1;
  h264.h264VUIParameters.videoFormat = NV_ENC_VUI_VIDEO_FORMAT_UNSPECIFIED;
  h264.h264VUIParameters.videoFullRangeFlag = 0;
  h264.h264VUIParameters.colourDescriptionPresentFlag = 1;
  h264.h264VUIParameters.colourPrimaries = NV_ENC_VUI_COLOR_PRIMARIES_BT709;
  h264.h264VUIParameters.transferCharacteristics = NV_ENC_VUI_TRANSFER_CHARACTERISTIC_BT709;
  h264.h264VUIParameters.colourMatrix = NV_ENC_VUI_MATRIX_COEFFS_BT709;

  NV_ENC_INITIALIZE_PARAMS init = { NV_ENC_INITIALIZE_PARAMS_VER };
  init.encodeGUID = NV_ENC_CODEC_H264_GUID;
  init.presetGUID = NV_ENC_PRESET_P4_GUID;
  init.tuningInfo = NV_ENC_TUNING_INFO_ULTRA_LOW_LATENCY;
  init.encodeWidth = W; init.encodeHeight = H;
  init.darWidth = W; init.darHeight = H;
  init.maxEncodeWidth = W; init.maxEncodeHeight = H;
  init.frameRateNum = o.fps; init.frameRateDen = 1;
  init.enablePTD = 1;
  init.encodeConfig = &cfg;
  NV(nv.fn.nvEncInitializeEncoder(nv.enc, &init), "NVENC não aceitou a configuração");

  NV_ENC_CREATE_BITSTREAM_BUFFER bs = { NV_ENC_CREATE_BITSTREAM_BUFFER_VER };
  NV(nv.fn.nvEncCreateBitstreamBuffer(nv.enc, &bs), "memória do NVENC");
  NV_ENC_REGISTER_RESOURCE reg = { NV_ENC_REGISTER_RESOURCE_VER };
  reg.resourceType = NV_ENC_INPUT_RESOURCE_TYPE_DIRECTX;
  reg.width = W; reg.height = H;
  reg.resourceToRegister = (ID3D11Texture2D *)nv12;
  reg.bufferFormat = NV_ENC_BUFFER_FORMAT_NV12;
  reg.bufferUsage = NV_ENC_INPUT_IMAGE;
  NV(nv.fn.nvEncRegisterResource(nv.enc, &reg), "textura no NVENC");

  session.StartCapture();
  char ready[64];
  snprintf(ready, sizeof(ready), "READY %u %u", W, H);
  logLine(ready);

  // Ritmo fixo de quadros: se a tela não mudou, repete o último (o vídeo de quem assiste não para)
  HANDLE timer = CreateWaitableTimerExW(nullptr, nullptr, CREATE_WAITABLE_TIMER_HIGH_RESOLUTION, TIMER_ALL_ACCESS);
  if (!timer) timer = CreateWaitableTimerW(nullptr, FALSE, nullptr);
  LARGE_INTEGER freq, t0, now;
  QueryPerformanceFrequency(&freq);
  QueryPerformanceCounter(&t0);
  const double tick = (double)freq.QuadPart / o.fps;  // um quadro, em unidades do relógio
  double next = (double)t0.QuadPart;
  uint64_t captured = 0, encoded = 0;
  ULONGLONG lastStats = GetTickCount64();
  bool haveImage = false;

  for (;;) {
    // Espera até a hora do próximo quadro (se atrasou mais de um quadro, recomeça a contagem)
    next += tick;
    QueryPerformanceCounter(&now);
    if ((double)now.QuadPart > next + tick) next = (double)now.QuadPart;
    double wait = next - (double)now.QuadPart;
    if (wait > 0) {
      LARGE_INTEGER due;
      due.QuadPart = -(LONGLONG)(wait * 1e7 / freq.QuadPart);
      SetWaitableTimer(timer, &due, 0, nullptr, nullptr, FALSE);
      WaitForSingleObject(timer, 1000);
    }
    if (ended) { logLine("ENDED"); ExitProcess(2); }

    // Pega o quadro mais novo da captura (descarta os mais velhos)
    Direct3D11CaptureFrame frame{ nullptr };
    for (auto f = pool.TryGetNextFrame(); f; f = pool.TryGetNextFrame()) { if (frame) frame.Close(); frame = f; }
    if (frame) {
      captured++;
      auto cs = frame.ContentSize();
      if ((UINT)cs.Width != srcW || (UINT)cs.Height != srcH) {
        if (cs.Width > 0 && cs.Height > 0) {
          pool.Recreate(device, DirectXPixelFormat::B8G8R8A8UIntNormalized, 2, cs);
          setupSource(cs.Width, cs.Height);
          wantKey = true;
        }
      } else {
        auto access = frame.Surface().as<::Windows::Graphics::DirectX::Direct3D11::IDirect3DDxgiInterfaceAccess>();
        Com<ID3D11Texture2D> tex;
        HR(access->GetInterface(__uuidof(ID3D11Texture2D), (void **)tex.put()), "quadro da captura");
        D3D11_BOX box = { 0, 0, 0, srcW, srcH, 1 };
        g.ctx->CopySubresourceRegion(bgra, 0, 0, 0, 0, tex, 0, &box);
        D3D11_VIDEO_PROCESSOR_STREAM stream = {};
        stream.Enable = TRUE;
        stream.pInputSurface = inView;
        HR(vctx->VideoProcessorBlt(vp, outView, 0, 1, &stream), "conversão do quadro");
        haveImage = true;
      }
      frame.Close();
    }

    if (GetTickCount64() - lastStats >= 1000) {
      lastStats = GetTickCount64();
      char s[64];
      snprintf(s, sizeof(s), "STATS %llu %llu", (unsigned long long)captured, (unsigned long long)encoded);
      logLine(s);
    }
    if (!haveImage || paused) continue;

    if (uint32_t b = newBitrate.exchange(0)) {
      setBitrate(b);
      NV_ENC_RECONFIGURE_PARAMS rp = { NV_ENC_RECONFIGURE_PARAMS_VER };
      rp.reInitEncodeParams = init;
      NV(nv.fn.nvEncReconfigureEncoder(nv.enc, &rp), "mudança de bitrate");
    }

    NV_ENC_MAP_INPUT_RESOURCE map = { NV_ENC_MAP_INPUT_RESOURCE_VER };
    map.registeredResource = reg.registeredResource;
    NV(nv.fn.nvEncMapInputResource(nv.enc, &map), "entrada do NVENC");
    QueryPerformanceCounter(&now);
    double tsUs = (double)(now.QuadPart - t0.QuadPart) * 1e6 / freq.QuadPart;
    NV_ENC_PIC_PARAMS pic = { NV_ENC_PIC_PARAMS_VER };
    pic.inputBuffer = map.mappedResource;
    pic.bufferFmt = map.mappedBufferFmt;
    pic.inputWidth = W;
    pic.inputHeight = H;
    pic.outputBitstream = bs.bitstreamBuffer;
    pic.pictureStruct = NV_ENC_PIC_STRUCT_FRAME;
    pic.inputTimeStamp = (uint64_t)tsUs;
    if (wantKey.exchange(false)) pic.encodePicFlags = NV_ENC_PIC_FLAG_FORCEIDR | NV_ENC_PIC_FLAG_OUTPUT_SPSPPS;
    NV(nv.fn.nvEncEncodePicture(nv.enc, &pic), "codificação");

    NV_ENC_LOCK_BITSTREAM lock = { NV_ENC_LOCK_BITSTREAM_VER };
    lock.outputBitstream = bs.bitstreamBuffer;
    NV(nv.fn.nvEncLockBitstream(nv.enc, &lock), "saída do NVENC");
    bool key = lock.pictureType == NV_ENC_PIC_TYPE_IDR || lock.pictureType == NV_ENC_PIC_TYPE_I;
    writeFrame(lock.bitstreamBufferPtr, lock.bitstreamSizeInBytes, key, tsUs);
    nv.fn.nvEncUnlockBitstream(nv.enc, bs.bitstreamBuffer);
    nv.fn.nvEncUnmapInputResource(nv.enc, map.mappedResource);
    encoded++;
  }
}

int main() {
  int argc = 0;
  wchar_t **argv = CommandLineToArgvW(GetCommandLineW(), &argc);
  if (argc >= 2 && wcscmp(argv[1], L"--probe") == 0) return probe();

  Options o;
  for (int i = 1; i + 1 < argc; i += 2) {
    const wchar_t *k = argv[i], *v = argv[i + 1];
    if (wcscmp(k, L"--window") == 0) o.window = (HWND)(uintptr_t)_wcstoui64(v, nullptr, 10);
    else if (wcscmp(k, L"--monitor") == 0) { o.monitor = true; swscanf_s(v, L"%ld,%ld", &o.monitorPoint.x, &o.monitorPoint.y); }
    else if (wcscmp(k, L"--width") == 0) o.maxW = wcstoul(v, nullptr, 10);
    else if (wcscmp(k, L"--height") == 0) o.maxH = wcstoul(v, nullptr, 10);
    else if (wcscmp(k, L"--fps") == 0) o.fps = wcstoul(v, nullptr, 10);
    else if (wcscmp(k, L"--bitrate") == 0) o.bitrate = wcstoul(v, nullptr, 10);
  }
  if ((!o.window && !o.monitor) || o.fps < 1 || o.fps > 240 || o.maxW < 16 || o.maxH < 16 || o.bitrate < 100000) {
    logLine("uso: videocap.exe --probe | (--monitor X,Y | --window HWND) [--width W --height H --fps F --bitrate B]");
    return 1;
  }
  CreateThread(nullptr, 0, readCommands, nullptr, 0, nullptr);
  try {
    return run(o);
  } catch (hresult_error const &e) {
    fail(utf8(std::wstring(e.message())) + " (" + hex(e.code()) + ")");
  }
}
