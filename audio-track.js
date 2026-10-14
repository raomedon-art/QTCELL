(function (root) {
  'use strict';
  const VERSION = 'supertonic3-aafc6e3-steps8-normalize1-track1';
  const MAX_CACHE_BYTES = 512 * 1024 * 1024;
  let dbPromise;
  async function key(kind, value) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(VERSION + ':' + value));
    return kind + ':' + Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
  }
  function database() {
    if (typeof indexedDB === 'undefined') return Promise.resolve(null);
    if (!dbPromise) dbPromise = new Promise(resolve => {
      const request = indexedDB.open('qt-ai-audio-cache-v1', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('audio', { keyPath: 'key' });
      request.onsuccess = () => { request.result.onversionchange = () => { request.result.close(); dbPromise = null; }; resolve(request.result); };
      request.onerror = request.onblocked = () => resolve(null);
    });
    return dbPromise;
  }
  async function get(cacheKey) {
    try {
      const db = await database();
      if (!db) return null;
      return await new Promise(resolve => {
        const request = db.transaction('audio').objectStore('audio').get(cacheKey);
        request.onsuccess = () => resolve(request.result?.value || null);
        request.onerror = () => resolve(null);
      });
    } catch { return null; }
  }
  async function put(cacheKey, value) {
    try {
      const db = await database();
      if (!db || value.blob.size > MAX_CACHE_BYTES) return false;
      return await new Promise(resolve => {
        const tx = db.transaction('audio', 'readwrite'), store = tx.objectStore('audio');
        const entries = [];
        let total = value.blob.size;
        const scan = store.openCursor();
        scan.onsuccess = () => {
          const cursor = scan.result;
          if (cursor) {
            if (cursor.key !== cacheKey) { total += cursor.value.bytes; entries.push({ key: cursor.key, bytes: cursor.value.bytes, savedAt: cursor.value.savedAt }); }
            cursor.continue(); return;
          }
          entries.sort((a, b) => a.savedAt - b.savedAt);
          for (const entry of entries) {
            if (total <= MAX_CACHE_BYTES) break;
            store.delete(entry.key); total -= entry.bytes;
          }
          store.put({ key: cacheKey, value, bytes: value.blob.size, savedAt: Date.now() });
        };
        tx.oncomplete = () => resolve(true);
        tx.onerror = tx.onabort = () => resolve(false);
      });
    } catch { return false; }
  }
  function builder() {
    const parts = [], ends = [];
    let sampleRate = 0, byteCount = 0, count = 0;
    return {
      async append(blob, pauseMs = 0) {
        const header = new DataView(await blob.slice(0, 44).arrayBuffer());
        const word = offset => String.fromCharCode(...new Uint8Array(header.buffer, offset, 4));
        if (header.byteLength !== 44 || word(0) !== 'RIFF' || word(8) !== 'WAVE' || word(12) !== 'fmt ' || word(36) !== 'data'
          || header.getUint32(16, true) !== 16 || header.getUint16(20, true) !== 1 || header.getUint16(22, true) !== 1 || header.getUint16(34, true) !== 16) throw new Error('음성 파일 형식이 올바르지 않습니다.');
        const rate = header.getUint32(24, true), dataSize = header.getUint32(40, true);
        if (!rate || (sampleRate && rate !== sampleRate) || !dataSize || dataSize % 2 || blob.size < 44 + dataSize) throw new Error('음성 파일을 연결하지 못했습니다.');
        sampleRate = rate;
        parts.push(blob.slice(44, 44 + dataSize)); byteCount += dataSize;
        const silence = Math.round(sampleRate * Math.max(0, Math.min(500, pauseMs)) / 1000) * 2;
        if (silence) { parts.push(new Uint8Array(silence)); byteCount += silence; }
        if (byteCount > 0xffffffff - 36) throw new Error('한 번에 준비할 수 있는 음성 길이를 넘었습니다.');
        ends.push(byteCount / (sampleRate * 2)); count++;
      },
      finish() {
        if (!count) throw new Error('재생할 음성이 없습니다.');
        const header = new ArrayBuffer(44), view = new DataView(header);
        const word = (offset, text) => [...text].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
        word(0, 'RIFF'); view.setUint32(4, byteCount + 36, true); word(8, 'WAVE'); word(12, 'fmt ');
        view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
        view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
        word(36, 'data'); view.setUint32(40, byteCount, true);
        return { blob: new Blob([header, ...parts], { type: 'audio/wav' }), ends, duration: ends.at(-1) };
      },
    };
  }
  const api = { key, get, put, builder };
  if (typeof module !== 'undefined') module.exports = api;
  else root.QTAudioTrack = api;
})(typeof window !== 'undefined' ? window : this);
