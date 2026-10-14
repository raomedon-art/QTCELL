import { ort, wasmBase, modelBase } from './voice-runtime.mjs';
import { TextToSpeech, UnicodeProcessor, loadVoiceStyle, writeWavFile } from './assets/tts/helper.mjs';
const threads = self.crossOriginIsolated ? Math.min(4, Math.max(1, Math.floor((navigator.hardwareConcurrency || 2) / 2))) : 1;
ort.env.wasm.numThreads = threads;
ort.env.wasm.wasmPaths = wasmBase;
let enginePromise, epoch = 0, queue = Promise.resolve();
const styles = new Map();
const base = modelBase;
const cacheName = 'qt-supertonic3-aafc6e3-v1';

async function modelBytes(path, id) {
  const url = base + path;
  let cache;
  try { cache = await caches.open(cacheName); } catch { /* Private browsing. */ }
  const cached = await cache?.match(url);
  if (cached) return cached.arrayBuffer();
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Model download failed: ${path} (HTTP ${response.status})`);
  const copy = response.clone(), total = Number(response.headers.get('content-length'));
  const reader = response.body.getReader(), parts = [];
  let loaded = 0, lastPercent = -1;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    parts.push(value); loaded += value.byteLength;
    const percent = total ? Math.round(loaded / total * 100) : Math.floor(loaded / 1048576);
    if (percent !== lastPercent) {
      self.postMessage({ id: -1, type: 'progress', message: `목소리 파일을 내려받고 있습니다 · ${total ? percent + '%' : percent + ' MB'}` });
      lastPercent = percent;
    }
  }
  const bytes = new Uint8Array(loaded);
  let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
  try { await cache?.put(url, copy); } catch { /* Quota must not block playback. */ }
  return bytes.buffer;
}

async function loadEngine(id) {
  const cfgResponse = await fetch(base + 'onnx/tts.json');
  const indexResponse = await fetch(base + 'onnx/unicode_indexer.json');
  if (!cfgResponse.ok || !indexResponse.ok) throw new Error('Missing configuration');
  const cfg = await cfgResponse.json(), processor = new UnicodeProcessor(await indexResponse.json());
  const sessions = [];
  try {
    for (const name of ['duration_predictor', 'text_encoder', 'vector_estimator', 'vocoder']) {
      self.postMessage({ id: -1, type: 'progress', message: `목소리 준비 중 · ${sessions.length + 1} / 4` });
      sessions.push(await ort.InferenceSession.create(await modelBytes(`onnx/${name}.onnx`, id), { executionProviders: ['wasm'], graphOptimizationLevel: 'all' }));
    }
    return new TextToSpeech(cfg, processor, ...sessions);
  } catch (error) { await Promise.allSettled(sessions.map(s => s.release())); throw error; }
}

async function synthesize(job) {
  if (job.epoch !== epoch) return;
  try {
    enginePromise ||= loadEngine(job.id).catch(error => { enginePromise = null; throw error; });
    const engine = await enginePromise;
    if (job.epoch !== epoch) return;
    if (!['F1','F2','M1','M2'].includes(job.voice)) throw new Error('Invalid voice');
    if (!styles.has(job.voice)) styles.set(job.voice, await loadVoiceStyle([base + `voice_styles/${job.voice}.json`]));
    const started = performance.now();
    const result = await engine.call(job.text, 'ko', styles.get(job.voice), 5, 1.0, 0.16, (step, total) => {
      if (job.epoch !== epoch) throw new Error('cancelled');
      self.postMessage({ id: job.id, type: 'progress', message: `AI 음성을 만들고 있습니다 · ${step} / ${total}` });
    });
    if (job.epoch !== epoch) return;
    const length = Math.min(result.wav.length, Math.ceil(result.duration[0] * engine.sampleRate));
    const wav = writeWavFile(result.wav.slice(0, length), engine.sampleRate);
    self.postMessage({ id: job.id, type: 'result', wav, seconds: length / engine.sampleRate, elapsedMs: performance.now() - started, threads }, [wav]);
  } catch (error) {
    if (job.epoch === epoch) {
      console.error('Local AI voice failed:', error.message);
      self.postMessage({ id: job.id, type: 'error', message: '음성 파일을 불러오거나 실행하지 못했습니다. 인터넷 연결을 확인하고 다른 탭을 닫은 뒤 다시 시도해주세요.' });
    }
  }
}
self.onmessage = ({ data }) => {
  if (data.type === 'cancel') { epoch = data.epoch; return; }
  if (data.type === 'warmup') {
    enginePromise ||= loadEngine(-1).catch(error => { enginePromise = null; throw error; });
    enginePromise.catch(() => {});
    return;
  }
  if (data.type !== 'synthesize') return;
  epoch = data.epoch;
  queue = queue.then(() => synthesize(data));
};

