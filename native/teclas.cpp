// teclas.exe: avisa quando uma tecla (ou botão do mouse) é apertada e solta, para o "apertar para falar".
// Uso: teclas.exe <vk> [<vk> ...]   (códigos de tecla virtual do Windows, em decimal)
// Saída (uma linha por mudança): "down <vk>" ou "up <vk>". Termina sozinho quando o app fecha (stdin acaba).
// Só consulta o estado das teclas (GetAsyncKeyState) a cada 10 ms: não intercepta nada, não mexe no jogo.
#include <windows.h>
#include <cstdio>
#include <cstdlib>
#include <thread>
#include <vector>
#include <atomic>

int main(int argc, char** argv) {
  std::vector<int> keys;
  for (int i = 1; i < argc; i++) {
    const int vk = std::atoi(argv[i]);
    if (vk > 0 && vk < 256) keys.push_back(vk);
  }
  if (keys.empty()) {
    std::fprintf(stderr, "ERROR sem teclas\n");
    return 1;
  }
  std::atomic<bool> running{true};
  // Quando o app fecha, o stdin acaba: sai junto
  std::thread watch([&] {
    char buf[64];
    while (std::fgets(buf, sizeof buf, stdin)) {}
    running = false;
  });
  watch.detach();
  std::vector<bool> down(keys.size(), false);
  std::fprintf(stderr, "READY\n");
  std::fflush(stderr);
  timeBeginPeriod(1);
  while (running) {
    for (size_t i = 0; i < keys.size(); i++) {
      const bool now = (GetAsyncKeyState(keys[i]) & 0x8000) != 0;
      if (now != down[i]) {
        down[i] = now;
        std::printf("%s %d\n", now ? "down" : "up", keys[i]);
        std::fflush(stdout);
      }
    }
    Sleep(10);
  }
  timeEndPeriod(1);
  return 0;
}
