# Supressão de ruído com IA (RNNoise)

Arquivos copiados de `@sapphi-red/web-noise-suppressor` 0.4.1 (licença MIT, ver `LICENSE`):

- `rnnoiseWorklet.js`: `dist/rnnoise/workletProcessor.js`
- `rnnoise.wasm` e `rnnoise_simd.wasm`: `dist/rnnoise.wasm` e `dist/rnnoise_simd.wasm`

Eles incluem o [RNNoise](https://github.com/xiph/rnnoise) (Xiph.Org / Jean-Marc Valin, licença BSD de 3 cláusulas)
compilado para WebAssembly pelo [@shiguredo/rnnoise-wasm](https://github.com/shiguredo/rnnoise-wasm) (licença Apache-2.0).

Para atualizar: `npm i @sapphi-red/web-noise-suppressor` e copie de novo os três arquivos.
