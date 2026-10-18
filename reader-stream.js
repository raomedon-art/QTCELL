(function (root) {
  'use strict';
  // Preload the next clips while the current clip plays. No synthesis or added
  // timeout runs in the transition between clips; pauses are already in the WAV.
  class Stream {
    constructor({ rate = 0.9, onState, onPosition, onTime, onComplete, onError, startFraction = 0, startPaused = false }) {
      Object.assign(this, { rate, onState, onPosition, onTime, onComplete, onError, startFraction, startPaused });
      this.entries = []; this.cursor = 0; this.started = false; this.paused = false;
      this.stopped = false; this.complete = false; this.current = null; this.waiters = [];
    }
    append(blob, duration) {
      if (this.stopped) return;
      this.entries.push({ blob, duration }); this.prime();
      if (this.started && !this.paused && !this.current) this.advance();
    }
    prime() {
      if (this.stopped) return;
      for (let i = this.cursor; i < Math.min(this.entries.length, this.cursor + 3); i++) {
        const entry = this.entries[i];
        if (entry.audio) continue;
        entry.url = URL.createObjectURL(entry.blob); entry.audio = new Audio(entry.url);
        entry.audio.preload = 'auto'; entry.audio.preservesPitch = true; entry.audio.playbackRate = this.rate;
        entry.audio.load();
      }
    }
    bufferedSeconds() {
      return Math.max(0, this.entries.slice(this.cursor).reduce((sum, entry) => sum + entry.duration, 0) - (this.current?.currentTime || 0)) / this.rate;
    }
    waitForRoom() {
      if (this.stopped || this.bufferedSeconds() < 60) return Promise.resolve();
      return new Promise(resolve => this.waiters.push(resolve));
    }
    wake() { this.waiters.splice(0).forEach(resolve => resolve()); }
    finish() { this.complete = true; if (this.started && !this.paused && !this.current) this.advance(); }
    start() {
      this.started = true; this.paused = false;
      if (this.startPaused) {
        this.startPaused = false; this.prime(); this.current = this.entries[this.cursor]?.audio;
        if (this.current) this.current.currentTime = this.entries[this.cursor].duration * this.startFraction;
        this.startFraction = 0; this.paused = true; this.onPosition(this.cursor); this.onState('paused'); return;
      }
      return this.advance();
    }
    async advance() {
      if (this.stopped || this.paused) return;
      if (this.cursor >= this.entries.length) {
        if (this.complete) { this.stopped = true; this.wake(); this.onComplete(); }
        else this.onState('loading', '뒤의 음성을 준비하고 있습니다. 준비되면 자동으로 이어집니다.');
        return;
      }
      this.prime();
      const entry = this.entries[this.cursor], audio = entry.audio;
      this.current = audio;
      if (this.startFraction) { audio.currentTime = entry.duration * this.startFraction; this.startFraction = 0; }
      audio.ontimeupdate = () => { if (!this.stopped && this.current === audio) this.onTime?.(this.cursor, audio.currentTime / entry.duration); };
      audio.onended = () => {
        if (this.stopped || this.current !== audio) return;
        this.release(entry); this.current = null; this.cursor++; this.wake();
        this.advance();
      };
      audio.onerror = () => { if (!this.stopped) { this.stop(); this.onError('생성한 음성을 재생하지 못했습니다. 다시 시도해주세요.'); } };
      try {
        await audio.play();
        if (!this.stopped && !this.paused && this.current === audio) { this.onPosition(this.cursor); this.onState('playing'); }
      } catch {
        if (!this.stopped && this.current === audio) {
          this.paused = true; this.onState('paused', '음성이 준비되었습니다. 이어 듣기를 눌러 재생해주세요.');
        }
      }
    }
    pause() { this.paused = true; this.current?.pause(); this.onState('paused'); }
    resume() { this.paused = false; this.started = true; return this.advance(); }
    setRate(value) {
      this.rate = value;
      for (const entry of this.entries) if (entry.audio) entry.audio.playbackRate = value;
      this.wake();
    }
    release(entry) {
      if (!entry.audio) return;
      entry.audio.onended = entry.audio.onerror = entry.audio.ontimeupdate = null; entry.audio.pause(); entry.audio.removeAttribute('src'); entry.audio.load();
      URL.revokeObjectURL(entry.url); entry.audio = null; entry.url = null;
    }
    stop() { this.stopped = true; this.entries.forEach(entry => this.release(entry)); this.current = null; this.wake(); }
  }
  if (typeof module !== 'undefined') module.exports = Stream;
  else root.QTAudioStream = Stream;
})(typeof window !== 'undefined' ? window : this);

