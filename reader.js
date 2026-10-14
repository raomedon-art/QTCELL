(() => {
  "use strict";

  const panel = document.querySelector("#detail-reader");
  const summary = document.querySelector("#detail-summary");
  const play = document.querySelector("#reader-play");
  const stopButton = document.querySelector("#reader-stop");
  const rate = document.querySelector("#reader-rate");
  const readingStyle = document.querySelector("#reader-style");
  const voiceSelect = document.querySelector("#reader-voice");
  const status = document.querySelector("#reader-status");
  const progress = document.querySelector("#reader-progress");
  const supported = "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
  const synth = supported ? window.speechSynthesis : null;
  let voices = [];
  let hasOtherVoices = false;
  let chunks = [];
  let position = 0;
  let state = "idle";
  let generation = 0;
  let currentUtterance = null;
  let startTimer;
  let nextTimer;

  function koreanNumber(digits) {
    const value = Number(digits);
    if (!Number.isInteger(value) || value < 0 || value > 9999) return digits;
    if (value === 0) return "영";
    const names = ["", "일", "이", "삼", "사", "오", "육", "칠", "팔", "구"];
    const units = ["", "십", "백", "천"];
    return String(value).split("").map((digit, index, all) => {
      const place = all.length - index - 1;
      return digit === "0" ? "" : (digit === "1" && place > 0 ? "" : names[Number(digit)]) + units[place];
    }).join("");
  }

  // Transform only the speech copy, never the displayed/stored meditation.
  function normalizeSpeech(text) {
    return text
      .replace(/\r/g, "").replace(/[\u200B-\u200D\uFEFF]/g, "")
      .replace(/^[\t ]*[□■▪▫●○•※\uF000-\uF8FF]+[\t ]*/gm, "")
      // A shared unit also applies to the first number: 1~15절, 15-16절.
      .replace(/(\d+)[\t ]*([~～∼〜\-‐‑‒–—−])[\t ]*(\d+)[\t ]*(장|절)/g,
        (_, first, separator, last, unit) => `${koreanNumber(first)} ${unit}${/[~～∼〜]/.test(separator) ? "에서" : " "} ${koreanNumber(last)} ${unit}`)
      .replace(/(\d+)[\t ]*(장|절)/g, (_, digits, unit) => `${koreanNumber(digits)} ${unit}`)
      .replace(/[\t ]*[~～∼〜][\t ]*/g, "에서 ")
      .replace(/[\-‐‑‒–—−]/g, " ");
  }

  // Short sentences avoid the long-utterance failures of some speech engines.
  // Keep every word; split overlong sentences at spaces, then code-point boundaries.
  function splitText(text) {
    const cleaned = normalizeSpeech(text);
    const result = [];
    for (const line of cleaned.split("\n")) {
      if (!line.trim()) {
        if (result.length) result[result.length - 1].pause = 480;
        continue;
      }
      // Keep closing quotation marks with their sentence; don't split decimals.
      const sentences = line.match(/(?:[^.!?。！？]|(?<=\d)\.(?=\d))+[.!?。！？]*[”’"'」』)]*/gu) || [];
      for (const sentence of sentences) {
      let chars = Array.from(sentence.replace(/\s+/g, " ").trim());
      while (chars.length > 120) {
        const space = chars.slice(0, 120).lastIndexOf(" ");
        const end = space >= 60 ? space : 120;
        result.push({ text: chars.slice(0, end).join("").trim(), pause: 60 });
        chars = chars.slice(end);
        while (chars[0] === " ") chars.shift();
      }
      const last = chars.join("").trim();
      if (last) result.push({ text: last, pause: 220 });
      }
      if (result.length) result[result.length - 1].pause = 360;
    }
    return result.filter((chunk) => /[\p{L}\p{N}]/u.test(chunk.text));
  }

  function availabilityMessage() {
    if (!supported) return "이 브라우저는 본문 듣기를 지원하지 않습니다. Chrome 또는 Edge에서 열어주세요.";
    if (!chunks.length) return "읽을 텍스트가 없습니다. 이미지와 첨부 파일 안의 글은 읽지 않습니다.";
    if (hasOtherVoices && !voices.length) return "한국어 음성을 찾을 수 없습니다. 기기에 한국어 음성을 추가한 뒤 다시 열어주세요.";
    return "본문 듣기를 누르면 처음부터 읽어드립니다.";
  }

  function render(message) {
    const unavailable = !supported || !chunks.length || (hasOtherVoices && !voices.length);
    play.disabled = unavailable;
    play.textContent = state === "playing" ? "일시정지" : state === "paused" ? "이어 듣기" : "본문 듣기";
    play.setAttribute("aria-label", state === "playing" ? "본문 듣기 일시정지" : state === "paused" ? "본문 이어 듣기" : "본문 듣기");
    stopButton.disabled = !["playing", "paused"].includes(state);
    rate.disabled = unavailable;
    readingStyle.disabled = unavailable;
    voiceSelect.disabled = unavailable || voices.length < 2;
    progress.max = Math.max(1, chunks.length);
    progress.value = position;
    progress.setAttribute("aria-valuetext", `${position} / ${chunks.length} 구간 완료`);
    panel.dataset.state = state;
    status.textContent = message || (state === "playing"
      ? `읽는 중 · ${position + 1} / ${chunks.length} 구간`
      : state === "paused" ? `일시정지 · ${position + 1} / ${chunks.length} 구간` : availabilityMessage());
  }

  function cancelCurrent() {
    generation += 1;
    clearTimeout(startTimer);
    clearTimeout(nextTimer);
    if (currentUtterance) {
      currentUtterance.onstart = null;
      currentUtterance.onend = null;
      currentUtterance.onerror = null;
      currentUtterance = null;
    }
    if (supported) synth.cancel();
  }

  function stop(message) {
    cancelCurrent();
    state = "idle";
    position = 0;
    render(message);
  }

  function failure(error) {
    const messages = {
      "not-allowed": "음성 재생이 허용되지 않았습니다. 본문 듣기를 다시 누르거나 Chrome·Edge에서 열어주세요.",
      "language-unavailable": "한국어 음성을 사용할 수 없습니다. 기기의 한국어 음성 설정을 확인해주세요.",
      "voice-unavailable": "선택한 음성을 사용할 수 없습니다. 다른 음성을 선택해주세요.",
      "network": "음성을 불러오지 못했습니다. 인터넷 연결을 확인하거나 다른 음성을 선택해주세요.",
    };
    stop(messages[error] || "음성을 재생하지 못했습니다. 기기의 음성 설정을 확인하거나 Chrome·Edge에서 다시 시도해주세요.");
  }

  function speakCurrent() {
    if (state !== "playing") return;
    if (position >= chunks.length) {
      currentUtterance = null;
      state = "idle";
      render("본문을 모두 읽었습니다. 다시 들으려면 본문 듣기를 눌러주세요.");
      return;
    }
    const token = ++generation;
    const chunk = chunks[position];
    const utterance = new window.SpeechSynthesisUtterance(chunk.text);
    currentUtterance = utterance;
    utterance.lang = "ko-KR";
    utterance.rate = Number(rate.value) || 0.9;
    const selected = voices.find((voice) => voice.voiceURI === voiceSelect.value) || voices[0];
    if (selected) utterance.voice = selected;
    utterance.onstart = () => {
      if (generation !== token) return;
      clearTimeout(startTimer);
      render();
    };
    utterance.onend = () => {
      if (generation !== token || state !== "playing") return;
      clearTimeout(startTimer);
      currentUtterance = null;
      position += 1;
      if (position >= chunks.length || readingStyle.value !== "gentle") {
        speakCurrent();
      } else {
        render();
        nextTimer = setTimeout(() => {
          if (generation === token && state === "playing") speakCurrent();
        }, chunk.pause);
      }
    };
    utterance.onerror = (event) => {
      if (generation === token) failure(event.error);
    };
    render();
    startTimer = setTimeout(() => {
      if (generation === token) failure("start-timeout");
    }, 10000);
    try {
      synth.resume();
      synth.speak(utterance);
    } catch {
      failure("synthesis-failed");
    }
  }

  function loadVoices() {
    const previous = voiceSelect.value;
    const available = synth.getVoices();
    hasOtherVoices = available.length > 0;
    voices = available.filter((voice) => /^ko(?:[-_]|$)/i.test(voice.lang))
      .sort((a, b) => Number(Boolean(b.localService)) - Number(Boolean(a.localService)) || Number(Boolean(b.default)) - Number(Boolean(a.default)));
    voiceSelect.replaceChildren();
    for (const voice of voices) {
      const option = document.createElement("option");
      option.value = voice.voiceURI;
      option.textContent = voice.name;
      voiceSelect.append(option);
    }
    if (!voices.length) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = hasOtherVoices ? "한국어 음성 없음" : "기본 한국어 음성";
      voiceSelect.append(option);
    } else if (voices.some((voice) => voice.voiceURI === previous)) {
      voiceSelect.value = previous;
    }
    if (hasOtherVoices && !voices.length && state !== "idle") stop();
    else render();
  }

  play.addEventListener("click", () => {
    if (play.disabled) return;
    if (state === "playing") {
      // Cancel/restart the short current sentence works even on engines whose
      // native pause/resume drops the queue (notably some mobile engines).
      cancelCurrent();
      state = "paused";
      render();
      return;
    }
    if (state !== "paused") position = 0;
    cancelCurrent();
    state = "playing";
    speakCurrent();
  });
  stopButton.addEventListener("click", () => stop("듣기를 멈췄습니다. 다시 누르면 처음부터 읽습니다."));
  for (const control of [rate, voiceSelect, readingStyle]) {
    control.addEventListener("change", () => {
      if (state !== "playing") return;
      cancelCurrent();
      speakCurrent();
    });
  }
  window.addEventListener("pagehide", () => stop());

  window.QTReader = Object.freeze({
    stop,
    refresh(hasContent) {
      stop();
      chunks = hasContent ? splitText(summary.innerText) : [];
      render();
    },
    setEditing(editing) {
      if (editing) stop();
      panel.hidden = editing;
    },
  });
  if (supported) {
    synth.addEventListener("voiceschanged", loadVoices);
    loadVoices();
  }
  render();
})();
