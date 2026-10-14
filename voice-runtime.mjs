// Pin the runtime and model independently of the GitHub Pages upload.
// Downloads contain model data only; synthesis stays in this browser.
import * as runtime from './assets/tts/runtime/ort.wasm.min.mjs';
const local = ['localhost', '127.0.0.1', '[::1]'].includes(globalThis.location.hostname);
const cdn = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.30.0/dist/';
export const ort = runtime;
export const wasmBase = local ? new URL('./assets/tts/runtime/', import.meta.url).href : {
  mjs: new URL('./assets/tts/runtime/ort-wasm-simd-threaded.mjs', import.meta.url).href,
  wasm: cdn + 'ort-wasm-simd-threaded.wasm'
};
export const modelBase = local ? new URL('./assets/tts/model/', import.meta.url).href
  : 'https://huggingface.co/supertone-oss-archive/supertonic-3/resolve/aafc6e32416a594460b32413efc49d7fe4ce6d46/';
