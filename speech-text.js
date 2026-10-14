(function (root) {
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


  const api = { normalizeSpeech, splitText };
  if (typeof module !== 'undefined') module.exports = api;
  else root.QTVoiceText = api;
})(typeof window !== 'undefined' ? window : this);
