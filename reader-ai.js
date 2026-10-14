(() => {
  'use strict';
  const $ = id => document.querySelector('#' + id);
  const panel = $('detail-reader'), summary = $('detail-summary');
  const readingHighlight = window.QTReadingHighlight ? new window.QTReadingHighlight(summary) : null;
  const play = $('reader-play'), stopButton = $('reader-stop'), preview = $('reader-preview');
  const rate = $('reader-rate'), style = $('reader-style'), voice = $('reader-voice');
  const status = $('reader-status'), progress = $('reader-progress');
  const supported = typeof Worker !== 'undefined' && typeof Audio !== 'undefined';
  let chunks = [], position = 0, state = 'idle', generation = 0, workerEpoch = 0;
  let worker, requestId = 0, clip, clipUrl, previewing = false;
  let preparingTotal = 0, prepared = 0, lastTrack, stream, warmTimer, beganAt = 0, startedPlayback = false;
  const trackStore = window.QTAudioTrack;
  const pending = new Map(), cache = new Map(), inFlight = new Map();
  const nativeRequests = new Set();
  let backendProbe;
  let recordSource = null;
  let primed = null;
  const shared = new Map();
  const sample = '말씀을 함께 나누는 시간입니다. 오늘의 묵상을 차분하게 들어보세요.';

  function render(message) {
    if (!previewing && startedPlayback && (state === 'playing' || state === 'paused')) readingHighlight?.show(position);
    else readingHighlight?.clear();
    const busy = ['loading','playing','paused'].includes(state);
    play.disabled = !supported || (!chunks.length && !busy) || state === 'loading';
    const label = state === 'loading' ? 'AI 음성 준비 중…' : state === 'playing' ? '일시정지' : state === 'paused' ? '이어 듣기' : '본문 듣기';
    play.textContent = label;
    play.setAttribute('aria-label', state === 'playing' ? '본문 듣기 일시정지' : state === 'paused' ? '본문 이어 듣기' : label);
    stopButton.disabled = !busy; preview.disabled = !supported || busy; voice.disabled = !supported || busy; style.disabled = busy;
    const total = state === 'loading' || previewing ? preparingTotal : chunks.length;
    progress.max = Math.max(1, total);
    progress.value = state === 'loading' ? prepared : position;
    progress.setAttribute('aria-label', state === 'loading' ? '음성 준비 진행률' : '본문 듣기 진행률');
    progress.setAttribute('aria-valuetext', state === 'loading' ? `${prepared} / ${preparingTotal} 구간 준비` : `${position} / ${total} 구간 완료`);
    panel.dataset.state = state; panel.setAttribute('aria-busy', String(state === 'loading'));
    status.textContent = message || (state === 'playing' ? (previewing ? 'AI 목소리 미리 듣는 중' : `재생 중 · ${Math.min(position + 1, chunks.length)} / ${chunks.length} 구간 · ${prepared < preparingTotal ? "뒤의 음성을 미리 준비하고 있습니다" : "음성 준비 완료"}`)
      : state === 'paused' ? '일시정지했습니다. 이어 듣기를 누르면 멈춘 곳부터 재생합니다.'
      : !supported ? 'AI 음성 재생을 지원하는 최신 Chrome 또는 Edge에서 열어주세요.'
      : !chunks.length ? '읽을 텍스트가 없습니다. 이미지와 첨부 파일의 글은 읽지 않습니다.'
      : '본문 듣기를 누르면 준비된 음성으로 이어서 재생합니다.');
  }
  function cancelJobs() {
    for (const request of nativeRequests) request.abort();
    nativeRequests.clear();
    workerEpoch++; worker?.postMessage({ type: 'cancel', epoch: workerEpoch });
    for (const job of pending.values()) { clearTimeout(job.timeout); job.reject(new Error('cancelled')); }
    pending.clear(); inFlight.clear();
  }
  function clearClip() {
    if (clip) { clip.onended = clip.onerror = clip.ontimeupdate = clip.onwaiting = clip.onplaying = null; clip.pause(); clip.removeAttribute('src'); clip.load(); clip = null; }
    if (clipUrl) { URL.revokeObjectURL(clipUrl); clipUrl = null; }
  }
  function clearPrime() {
    if (primed) { primed.audio.pause(); primed.audio.removeAttribute('src'); primed.audio.load(); primed = null; }
  }
  function primeTrack(track) {
    if (!track?.url || primed?.url === track.url) return;
    clearPrime(); const audio = new Audio(track.url); audio.preload = 'auto'; audio.load();
    primed = { url: track.url, audio };
  }
  async function initialBuffer(audio, token) {
    if (typeof audio.addEventListener !== 'function') return;
    await new Promise(resolve => {
      let timer;
      const events = ['progress','canplay','canplaythrough','loadedmetadata'];
      function done() {
        clearTimeout(timer); events.forEach(event => audio.removeEventListener(event, check));
        audio.removeEventListener('error', done); audio.removeEventListener('emptied', done); resolve();
      }
      function check() {
        if (token !== generation) return done();
        const target = Math.min(Number.isFinite(audio.duration) ? audio.duration : Infinity, 12 * (Number(rate.value) || 0.9));
        if (audio.readyState >= 3 && audio.buffered.length && audio.buffered.end(0) >= target - 0.05) done();
      }
      events.forEach(event => audio.addEventListener(event, check));
      audio.addEventListener('error', done); audio.addEventListener('emptied', done);
      timer = setTimeout(done, 6000); check();
    });
  }
  function stop(message) {
    generation++; clearTimeout(warmTimer); stream?.stop(); stream = null; cancelJobs(); clearClip();
    state = 'idle'; position = 0; prepared = 0; preparingTotal = 0; previewing = false; startedPlayback = false; render(message);
  }
  function failJobs(message) {
    worker?.terminate(); worker = null;
    for (const job of pending.values()) { clearTimeout(job.timeout); job.reject(new Error(message)); }
    pending.clear(); inFlight.clear();
  }
  function ensureWorker() {
    if (worker) return;
    worker = new Worker('./voice-worker.mjs?v=20261014-bundled-2', { type: 'module' });
    worker.onmessage = ({ data }) => {
      if (data.id === -1 && data.type === 'progress') {
        for (const waiting of pending.values()) waiting.onProgress?.(data.message);
        return;
      }
      const job = pending.get(data.id);
      if (!job) return;
      if (data.type === 'progress') { job.onProgress?.(data.message); return; }
      clearTimeout(job.timeout); pending.delete(data.id);
      if (data.type === 'result') {
        panel.dataset.workerThreads = String(data.threads); panel.dataset.generationMs = String(Math.round(data.elapsedMs)); panel.dataset.audioSeconds = String(data.seconds);
        job.resolve(new Blob([data.wav], { type: 'audio/wav' }));
      }
      else job.reject(new Error(data.message));
    };
    worker.onerror = () => failJobs('AI 음성 엔진을 불러오지 못했습니다. 새로고침 후 다시 시도해주세요.');
  }
  async function nativeAvailable() {
    if (typeof fetch !== 'function') return false;
    if (globalThis.location && !['localhost', '127.0.0.1', '[::1]'].includes(globalThis.location.hostname)) return false;
    backendProbe ||= fetch('./api/voice/status', { signal: AbortSignal.timeout(2500) })
      .then(response => response.ok ? response.json() : null).then(info => !!info?.available).catch(() => false);
    return backendProbe;
  }
  async function generate(text, onProgress) {
    const key = voice.value + ':' + text, token = generation;
    if (cache.has(key)) return cache.get(key);
    const native = await nativeAvailable();
    if (token !== generation) throw new Error('cancelled');
    if (native) {
      const controller = new AbortController(); nativeRequests.add(controller);
      const timeout = setTimeout(() => controller.abort(), 60000);
      try {
        onProgress?.('빠른 음성을 준비하고 있습니다.');
        const response = await fetch('./api/voice', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, voice: voice.value }), signal: controller.signal });
        if (!response.ok) throw new Error('native unavailable');
        const blob = await response.blob();
        if (token !== generation) throw new Error('cancelled');
        panel.dataset.workerThreads = response.headers.get('X-Voice-Threads');
        panel.dataset.generationMs = response.headers.get('X-Voice-Generation-Ms');
        panel.dataset.audioSeconds = response.headers.get('X-Voice-Seconds');
        panel.dataset.voiceEngine = 'native';
        cache.set(key, blob); while (cache.size > 12) cache.delete(cache.keys().next().value);
        return blob;
      } catch (error) {
        if (token !== generation) throw error;
        backendProbe = Promise.resolve(false);
      } finally { clearTimeout(timeout); nativeRequests.delete(controller); }
    }
    panel.dataset.voiceEngine = 'wasm';
    return generateInWorker(text, onProgress);
  }
  function generateInWorker(text, onProgress) {
    const key = voice.value + ':' + text;
    if (cache.has(key)) return Promise.resolve(cache.get(key));
    if (inFlight.has(key)) return inFlight.get(key);
    ensureWorker(); const id = ++requestId;
    const promise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => failJobs('음성 준비 시간이 길어졌습니다. 인터넷 연결을 확인한 뒤 다시 시도해주세요.'), 600000);
      pending.set(id, { timeout, onProgress, reject, resolve: blob => {
        cache.set(key, blob);
        while (cache.size > 12) cache.delete(cache.keys().next().value);
        resolve(blob);
      } });
      worker.postMessage({ type: 'synthesize', id, epoch: workerEpoch, voice: voice.value, text });
    });
    inFlight.set(key, promise);
    promise.then(() => { if (inFlight.get(key) === promise) inFlight.delete(key); }, () => { if (inFlight.get(key) === promise) inFlight.delete(key); });
    return promise;
  }
  async function playClip(token, track) {
    if (token !== generation) return;
    clearClip();
    if (track.blob) clipUrl = URL.createObjectURL(track.blob);
    clip = track.url && primed?.url === track.url ? primed.audio : new Audio(track.url || clipUrl);
    if (primed?.audio === clip) primed = null;
    clip.preload = 'auto';
    panel.dataset.bufferWaits = '0';
    panel.dataset.bufferWaitPositions = ''; panel.dataset.bufferWaitMs = '0';
    let waitingSince = 0;
    clip.playbackRate = Number(rate.value) || 0.9; clip.preservesPitch = true;
    clip.onwaiting = () => {
      if (token === generation && startedPlayback && clip.currentTime > 0.05) {
        panel.dataset.bufferWaits = String(Number(panel.dataset.bufferWaits) + 1);
        panel.dataset.bufferWaitPositions += clip.currentTime.toFixed(2) + ','; waitingSince = performance.now();
      }
    };
    clip.onplaying = () => {
      if (token === generation && waitingSince) { panel.dataset.bufferWaitMs = String(Number(panel.dataset.bufferWaitMs) + Math.round(performance.now() - waitingSince)); waitingSince = 0; }
    };
    clip.ontimeupdate = () => {
      if (token !== generation || previewing) return;
      panel.dataset.audioPosition = String(clip.currentTime);
      const next = track.ends.findIndex(end => end > clip.currentTime);
      const currentPosition = next === -1 ? chunks.length : next;
      if (position !== currentPosition) { position = currentPosition; render(); }
    };
    clip.onended = () => {
      if (token !== generation) return;
      clearClip();
      if (previewing) { stop('목소리 미리 듣기를 마쳤습니다. 본문 듣기를 눌러보세요.'); return; }
      position = chunks.length;
      state = 'idle'; render('본문을 모두 읽었습니다. 다시 누르면 준비된 음성으로 바로 재생합니다.');
    };
    clip.onerror = () => { if (token === generation) stop('생성한 음성을 재생하지 못했습니다. 다시 시도해주세요.'); };
    try {
      if (track.url) await initialBuffer(clip, token);
      if (token !== generation) return;
      await clip.play(); if (token !== generation) return; startedPlayback = true; state = 'playing'; render();
    }
    catch { if (token === generation) { state = 'paused'; render('음성이 준비되었습니다. 이어 듣기를 눌러 재생해주세요.'); } }
  }
  async function sharedTrack(isPreview, selectedVoice, selectedStyle) {
    const source = recordSource;
    if (!source?.storage) return null;
    const raw = isPreview ? sample : source.content;
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
    const hash = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
    const base = `audio/v1/${isPreview ? 'preview' : source.id}/${hash}/${selectedVoice}`;
    const cacheKey = base + '/' + selectedStyle;
    const cached = shared.get(cacheKey);
    if (cached?.expires > Date.now()) return cached.promise;
    const promise = (async () => {
      // Sign the small cue sheet and audio together. Audio itself is streamed by
      // the media element; never wait for its full download or start a Worker.
      const paths = [base + '/manifest.json', base + '/' + selectedStyle + '.ogg'];
      const { data, error } = await source.storage.createSignedUrls(paths, 86400);
      if (error || !data?.[0]?.signedUrl || !data?.[1]?.signedUrl) return null;
      const response = await fetch(data[0].signedUrl, { signal: AbortSignal.timeout(8000) });
      if (!response.ok) return null;
      const manifest = await response.json(), track = manifest.tracks?.[selectedStyle];
      if (manifest.version !== 1 || manifest.sourceHash !== hash || manifest.voice !== selectedVoice
        || !Array.isArray(manifest.chunks) || !manifest.chunks.length || !track
        || track.path !== paths[1] || track.ends?.length !== manifest.chunks.length
        || !track.ends.every((end, i) => Number.isFinite(end) && end > (i ? track.ends[i - 1] : 0))
        || !manifest.chunks.every(chunk => typeof chunk.text === 'string' && chunk.text.trim())) return null;
      return { url: data[1].signedUrl, ends: track.ends, chunks: manifest.chunks };
    })().catch(() => null);
    shared.set(cacheKey, { promise, expires: Date.now() + 23 * 60 * 60 * 1000 });
    promise.then(result => { if (!result && shared.get(cacheKey)?.promise === promise) shared.delete(cacheKey); });
    return promise;
  }
  async function prepareAndPlay(token) {
    if (token !== generation) return;
    const selectedVoice = voice.value, selectedStyle = style.value;
    const selectedChunks = previewing ? window.QTVoiceText.splitText(sample) : chunks;
    preparingTotal = selectedChunks.length; prepared = 0; beganAt = performance.now();
    state = 'loading'; render('저장된 음성을 확인하고 있습니다.');
    try {
      const ready = await sharedTrack(previewing, selectedVoice, selectedStyle);
      if (token !== generation) return;
      if (ready) {
        if (!previewing) { chunks = ready.chunks; readingHighlight?.refresh(chunks); }
        preparingTotal = ready.chunks.length; prepared = preparingTotal;
        panel.dataset.voiceEngine = 'shared-audio';
        await playClip(token, ready);
        if (token === generation) panel.dataset.startupMs = String(Math.round(performance.now() - beganAt));
        return;
      }
      const key = await trackStore.key('track', JSON.stringify([selectedVoice, selectedStyle, selectedChunks]));
      if (token !== generation) return;
      const stored = lastTrack?.key === key ? lastTrack.track : await trackStore.get(key);
      if (token !== generation) return;
      if (stored) {
        prepared = preparingTotal; lastTrack = { key, track: stored }; await playClip(token, stored);
        if (token === generation) panel.dataset.startupMs = String(Math.round(performance.now() - beganAt));
        return;
      }
      const joined = trackStore.builder();
      const currentStream = stream = new window.QTAudioStream({
        rate: Number(rate.value) || 0.9,
        onState(next, message) {
          if (token !== generation) return;
          if (next === 'playing' && !startedPlayback) { startedPlayback = true; panel.dataset.startupMs = String(Math.round(performance.now() - beganAt)); }
          state = next; render(message);
        },
        onPosition(next) { if (token === generation) { position = next; render(); } },
        onComplete() {
          if (token !== generation) return;
          if (previewing) { stop('목소리 미리 듣기를 마쳤습니다. 본문 듣기를 눌러보세요.'); return; }
          state = 'idle'; position = chunks.length; render('본문을 모두 읽었습니다. 준비한 음성은 다음에 재사용합니다.');
        },
        onError(message) { if (token === generation) stop(message); },
      });
      const writes = [];
      for (let i = 0; i < selectedChunks.length; i++) {
        while (!currentStream.stopped && currentStream.bufferedSeconds() >= 60) await currentStream.waitForRoom();
        if (token !== generation || currentStream.stopped) return;
        const chunk = selectedChunks[i];
        const legacyKey = await trackStore.key('chunk', JSON.stringify([selectedVoice, chunk.text]));
        const chunkKey = await trackStore.key('fast-chunk', JSON.stringify([selectedVoice, chunk.text, 5]));
        if (token !== generation) return;
        const cached = await trackStore.get(chunkKey) || await trackStore.get(legacyKey);
        if (token !== generation) return;
        let blob = cached?.blob;
        if (!blob) {
          const update = detail => {
            if (token === generation && state === 'loading') render((startedPlayback ? '뒤의 음성 준비' : '앞부분 음성 준비') + ' · ' + prepared + ' / ' + preparingTotal + ' · ' + detail);
          };
          update('앞부분이 준비되면 먼저 재생합니다.');
          blob = await generate(chunk.text, update);
          if (token !== generation) return;
          writes.push(trackStore.put(chunkKey, { blob }));
        }
        if (token !== generation) return;
        const pause = i < selectedChunks.length - 1 && selectedStyle === 'gentle' ? Math.min(160, chunk.pause) : 0;
        await joined.append(blob, pause);
        const segmentBuilder = trackStore.builder(); await segmentBuilder.append(blob, pause);
        if (token !== generation) return;
        const segment = segmentBuilder.finish();
        prepared = i + 1; currentStream.append(segment.blob, segment.duration);
        // A short initial reserve; keep generating up to a minute ahead while listening.
        const nativeKeepsUp = panel.dataset.voiceEngine === 'native' && Number(panel.dataset.generationMs) / 1000 < segment.duration * 0.85;
        if (!currentStream.started && (i === selectedChunks.length - 1 || ((prepared >= 2 || nativeKeepsUp) && currentStream.bufferedSeconds() >= 6) || prepared >= 4)) currentStream.start();
        if (state === 'loading') render('앞부분 음성 준비 · ' + prepared + ' / ' + preparingTotal + ' · 전체 완성을 기다리지 않고 재생합니다.');
        else render();
      }
      if (token !== generation) return;
      const track = joined.finish(); lastTrack = { key, track };
      // Persistence must never delay playback or the next generated segment.
      writes.push(trackStore.put(key, track));
      currentStream.finish();
      await Promise.allSettled(writes);
    } catch (error) { if (token === generation) stop(error.message); }
  }
  play.addEventListener('click', async () => {
    if (play.disabled) return;
    if (state === 'playing') { if (stream) stream.pause(); else { clip?.pause(); state = 'paused'; render(); } return; }
    if (state === 'paused' && stream) { stream.resume(); return; }
    if (state === 'paused' && clip) {
      const token = generation;
      try { await clip.play(); if (token === generation) { state = 'playing'; render(); } }
      catch { if (token === generation) render('재생을 시작하지 못했습니다. 다시 눌러주세요.'); }
      return;
    }
    stop(); prepareAndPlay(generation);
  });
  preview.addEventListener('click', () => { stop(); previewing = true; prepareAndPlay(generation); });
  stopButton.addEventListener('click', () => stop('듣기를 멈췄습니다. 준비된 부분은 저장되어 다음 준비에 재사용합니다.'));
  rate.addEventListener('change', () => { stream?.setRate(Number(rate.value) || 0.9); if (clip) clip.playbackRate = Number(rate.value) || 0.9; });
  function prefetchShared() {
    const token = generation;
    if (chunks.length) sharedTrack(false, voice.value, style.value).then(track => { if (token === generation) primeTrack(track); });
    sharedTrack(true, voice.value, style.value);
  }
  voice.addEventListener('change', () => { stop('목소리를 바꿨습니다. 미리 듣기로 확인해보세요.'); clearPrime(); prefetchShared(); });
  style.addEventListener('change', () => { stop(); clearPrime(); prefetchShared(); });
  window.addEventListener('pagehide', () => { stop(); clearPrime(); worker?.terminate(); worker = null; cache.clear(); });
  window.QTReader = Object.freeze({
    stop,
    refresh(hasContent, source = null) { stop(); clearPrime(); recordSource = source; chunks = hasContent ? window.QTVoiceText.splitText(summary.innerText) : []; readingHighlight?.refresh(chunks); cache.clear(); render();
      if (supported && chunks.length) {
        const token = generation;
        warmTimer = setTimeout(async () => {
          try {
            const ready = await sharedTrack(false, voice.value, style.value);
            if (token !== generation) return;
            if (ready) { primeTrack(ready); panel.dataset.voiceEngine = 'shared-audio'; render('음성이 준비되어 있습니다. 본문 듣기를 눌러보세요.'); return; }
            const key = await trackStore.key('track', JSON.stringify([voice.value, style.value, chunks]));
            const saved = lastTrack?.key === key || await trackStore.get(key);
            const native = await nativeAvailable();
            // Public readers must not download 412 MB merely by opening a page.
            // The local generation fallback is started only by an explicit play.
            if (token === generation && !saved && !native && !recordSource?.storage) { ensureWorker(); worker.postMessage({ type: 'warmup' }); }
          } catch { /* Warmup is optional; listening can retry. */ }
        }, 350);
      }
    },
    setEditing(editing) { if (editing) { stop(); clearPrime(); } panel.hidden = editing; },
  });
  render();
})();

