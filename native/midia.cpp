// midia.exe: o que está tocando agora, lido dos controles de mídia do Windows (os da tela de volume), para a atividade
// do perfil (main/atividade.js). Só players de música da lista abaixo: navegador e outros apps não aparecem.
// Uso: midia.exe   (sem argumentos)
// Saída (uma linha JSON por mudança): {"tocando":false} ou
//   {"tocando":true,"app":"Spotify.exe","faixa":"...","artista":"...","album":"...","capa":"<JPEG 96x96 em base64>"}
// Não fica perguntando: dorme até o Windows avisar que a faixa ou o play/pause mudou (e confere a cada 30 s por
// garantia). Termina sozinho quando o app fecha (stdin acaba).
#include <windows.h>
#include <fcntl.h>
#include <io.h>
#include <winrt/Windows.Foundation.h>
#include <winrt/Windows.Foundation.Collections.h>
#include <winrt/Windows.Graphics.Imaging.h>
#include <winrt/Windows.Media.Control.h>
#include <winrt/Windows.Security.Cryptography.h>
#include <winrt/Windows.Storage.Streams.h>
#include <atomic>
#include <cmath>
#include <cstdio>
#include <string>
#include <thread>
#include <vector>

using namespace winrt;
using namespace winrt::Windows::Graphics::Imaging;
using namespace winrt::Windows::Media::Control;
using namespace winrt::Windows::Storage::Streams;
using Sessao = GlobalSystemMediaTransportControlsSession;

static HANDLE g_mudou = nullptr;         // evento: algo mudou, conferir de novo
static std::atomic<bool> g_refazer{ true }; // a lista de players mudou: assinar os avisos de novo

// Players de música aceitos (pedaço do id do app, em minúsculas). Navegador fica de fora de propósito: o título de
// qualquer aba tocando vídeo apareceria no perfil.
static const wchar_t* PLAYERS[] = {
  L"spotify", L"applemusic", L"itunes", L"deezer", L"tidal", L"amazonmusic", L"amazon music", L"zunemusic",
  L"foobar2000", L"musicbee", L"aimp", L"winamp", L"youtube music", L"youtubemusic", L"qobuz", L"soundcloud",
};

static bool permitido(std::wstring id) {
  for (auto& c : id) c = static_cast<wchar_t>(towlower(c));
  for (auto p : PLAYERS) if (id.find(p) != std::wstring::npos) return true;
  return false;
}

static std::string utf8(std::wstring_view w) {
  if (w.empty()) return {};
  const int n = WideCharToMultiByte(CP_UTF8, 0, w.data(), static_cast<int>(w.size()), nullptr, 0, nullptr, nullptr);
  std::string s(n, '\0');
  WideCharToMultiByte(CP_UTF8, 0, w.data(), static_cast<int>(w.size()), s.data(), n, nullptr, nullptr);
  return s;
}

// Texto para dentro de uma string JSON, cortado em 200 bytes (o app corta de novo em 80 caracteres)
static std::string json(std::string s) {
  if (s.size() > 200) s.resize(200);
  std::string o;
  for (unsigned char c : s) {
    if (c == '"' || c == '\\') { o += '\\'; o += static_cast<char>(c); }
    else if (c < 0x20) o += ' ';
    else o += static_cast<char>(c);
  }
  return o;
}

// A capa: cortada no meio em quadrado, 96x96, JPEG. Vazia se não tem ou não deu para ler.
static std::string capaBase64(GlobalSystemMediaTransportControlsSessionMediaProperties const& p) {
  try {
    const auto ref = p.Thumbnail();
    if (!ref) return {};
    const auto entrada = ref.OpenReadAsync().get();
    const auto dec = BitmapDecoder::CreateAsync(entrada).get();
    const uint32_t w = dec.PixelWidth(), h = dec.PixelHeight();
    if (!w || !h) return {};
    const double esc = 96.0 / (w < h ? w : h);
    const uint32_t sw = (std::max)(96u, static_cast<uint32_t>(std::lround(w * esc)));
    const uint32_t sh = (std::max)(96u, static_cast<uint32_t>(std::lround(h * esc)));
    BitmapTransform t;
    t.ScaledWidth(sw);
    t.ScaledHeight(sh);
    t.Bounds({ (sw - 96) / 2, (sh - 96) / 2, 96, 96 }); // o corte vale depois da escala
    t.InterpolationMode(BitmapInterpolationMode::Fant);
    const auto bmp = dec.GetSoftwareBitmapAsync(BitmapPixelFormat::Bgra8, BitmapAlphaMode::Ignore, t,
      ExifOrientationMode::RespectExifOrientation, ColorManagementMode::DoNotColorManage).get();
    InMemoryRandomAccessStream saida;
    BitmapPropertySet opcoes;
    opcoes.Insert(L"ImageQuality", BitmapTypedValue(box_value(0.8f), winrt::Windows::Foundation::PropertyType::Single));
    const auto enc = BitmapEncoder::CreateAsync(BitmapEncoder::JpegEncoderId(), saida, opcoes).get();
    enc.SetSoftwareBitmap(bmp);
    enc.FlushAsync().get();
    const auto tam = static_cast<uint32_t>(saida.Size());
    if (!tam || tam > 20000) return {};
    saida.Seek(0);
    Buffer buf(tam);
    const auto lido = saida.ReadAsync(buf, tam, InputStreamOptions::None).get();
    return utf8(winrt::Windows::Security::Cryptography::CryptographicBuffer::EncodeToBase64String(lido));
  } catch (...) {
    return {};
  }
}

// Acha o primeiro player da lista que está tocando (sem nenhum, o primeiro pausado: "pausada":true) e escreve a linha,
// só se mudou desde a última
static void conferir(GlobalSystemMediaTransportControlsSessionManager const& gerente, std::string& ultima) {
  std::string chave, linha = "{\"tocando\":false}";
  try {
    const auto sessoes = gerente.GetSessions();
    for (int fase = 0; fase < 2 && chave.empty(); fase++) {
      const auto quer = fase == 0 ? GlobalSystemMediaTransportControlsSessionPlaybackStatus::Playing
                                  : GlobalSystemMediaTransportControlsSessionPlaybackStatus::Paused;
      for (const auto& s : sessoes) {
        const auto id = s.SourceAppUserModelId();
        if (!permitido(std::wstring(id))) continue;
        if (s.GetPlaybackInfo().PlaybackStatus() != quer) continue;
        const auto p = s.TryGetMediaPropertiesAsync().get();
        const std::string faixa = utf8(p.Title()), artista = utf8(p.Artist()), album = utf8(p.AlbumTitle()), app = utf8(id);
        if (faixa.empty()) continue;
        // a capa às vezes chega um instante depois do nome: entra na chave para escrever de novo quando chegar
        chave = std::string(fase ? "P\n" : "T\n") + app + '\n' + faixa + '\n' + artista + '\n' + album + '\n' + (p.Thumbnail() ? '1' : '0');
        if (chave == ultima) return;
        linha = std::string(fase ? "{\"tocando\":false,\"pausada\":true" : "{\"tocando\":true") + ",\"app\":\"" + json(app)
          + "\",\"faixa\":\"" + json(faixa) + "\",\"artista\":\"" + json(artista)
          + "\",\"album\":\"" + json(album) + "\",\"capa\":\"" + capaBase64(p) + "\"}";
        break;
      }
    }
  } catch (...) {
    return; // o Windows não respondeu agora: confere no próximo aviso
  }
  if (chave == ultima) return; // nada tocando, e já tinha avisado
  ultima = chave;
  std::fwrite(linha.data(), 1, linha.size(), stdout);
  std::fputc('\n', stdout);
  std::fflush(stdout);
}

int main() {
  init_apartment(apartment_type::multi_threaded);
  _setmode(_fileno(stdout), _O_BINARY); // \n puro, sem \r
  std::thread([] {
    char c;
    while (std::fread(&c, 1, 1, stdin) == 1) {}
    ExitProcess(0); // o app fechou
  }).detach();

  GlobalSystemMediaTransportControlsSessionManager gerente{ nullptr };
  try {
    gerente = GlobalSystemMediaTransportControlsSessionManager::RequestAsync().get();
  } catch (...) {
    std::fprintf(stderr, "ERROR sem controles de midia\n");
    return 1;
  }
  g_mudou = CreateEventW(nullptr, FALSE, TRUE, nullptr); // começa avisado: a primeira leitura sai logo
  const auto aviso = [](auto&&, auto&&) { SetEvent(g_mudou); };
  const auto lista = gerente.SessionsChanged(auto_revoke, [](auto&&, auto&&) { g_refazer = true; SetEvent(g_mudou); });
  std::vector<Sessao::MediaPropertiesChanged_revoker> r1;
  std::vector<Sessao::PlaybackInfoChanged_revoker> r2;
  std::string ultima = "?";
  for (;;) {
    if (WaitForSingleObject(g_mudou, 30000) == WAIT_OBJECT_0) Sleep(400); // junta a rajada de avisos de uma troca
    if (g_refazer.exchange(false)) {
      r1.clear();
      r2.clear();
      try {
        for (const auto& s : gerente.GetSessions()) {
          r1.push_back(s.MediaPropertiesChanged(auto_revoke, aviso));
          r2.push_back(s.PlaybackInfoChanged(auto_revoke, aviso));
        }
      } catch (...) {
        g_refazer = true;
      }
    }
    conferir(gerente, ultima);
  }
}
