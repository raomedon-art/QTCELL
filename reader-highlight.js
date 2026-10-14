(function (root) {
  'use strict';
  // Run the existing pronunciation normalizer through a replace adapter. Each
  // spoken character retains the UTF-16 source range, including 15 -> 십오.
  function mapSpeech(text, normalize) {
    const mapped = {
      text, starts: Array.from({ length: text.length }, (_, i) => i), ends: Array.from({ length: text.length }, (_, i) => i + 1),
      replace(pattern, replacement) {
        const pieces = [], starts = [], ends = []; let cursor = 0;
        const copy = end => {
          pieces.push(this.text.slice(cursor, end));
          for (let i = cursor; i < end; i++) { starts.push(this.starts[i]); ends.push(this.ends[i]); }
        };
        this.text.replace(pattern, (...args) => {
          const match = args[0], offset = args[args.length - 2];
          copy(offset);
          const value = typeof replacement === 'function' ? replacement(...args) : replacement;
          pieces.push(value);
          for (let i = 0; i < value.length; i++) { starts.push(this.starts[offset]); ends.push(this.ends[offset + match.length - 1]); }
          cursor = offset + match.length;
          return match;
        });
        copy(this.text.length);
        this.text = pieces.join(''); this.starts = starts; this.ends = ends;
        return this;
      },
    };
    normalize(mapped);
    return mapped;
  }
  function locateChunks(raw, chunks, normalize) {
    const mapped = mapSpeech(raw, normalize), chars = [], offsets = [];
    for (let i = 0; i < mapped.text.length; i++) {
      if (!/\s/.test(mapped.text[i])) { chars.push(mapped.text[i]); offsets.push(i); }
    }
    const compact = chars.join(''); let cursor = 0;
    return chunks.map(chunk => {
      const needle = chunk.text.replace(/\s/g, '');
      const index = needle ? compact.indexOf(needle, cursor) : -1;
      if (index < 0) return null; // Never highlight an unrelated paragraph.
      cursor = index + needle.length;
      return { start: mapped.starts[offsets[index]], end: mapped.ends[offsets[cursor - 1]] };
    });
  }
  class ReadingHighlight {
    constructor(container) { this.container = container; this.ranges = []; this.index = -1; this.block = null; }
    refresh(chunks) {
      this.clear(); this.ranges = [];
      let text = ''; const nodes = [];
      const visit = node => {
        if (node.nodeType === 3) {
          const start = text.length; text += node.nodeValue;
          nodes.push({ node, start, end: text.length }); return;
        }
        if (node.nodeType !== 1) return;
        if (node.matches('script,style,noscript,[hidden],[aria-hidden="true"]')) return;
        const style = root.getComputedStyle(node);
        if (style.display === 'none' || style.visibility === 'hidden') return;
        if (node.tagName === 'BR') { text += '\n'; return; }
        const block = !['inline', 'contents', 'inline-block', 'inline-flex'].includes(style.display);
        if (block) text += '\n';
        for (const child of node.childNodes) visit(child);
        if (block) text += '\n';
      };
      visit(this.container);
      this.ranges = locateChunks(text, chunks, root.QTVoiceText.normalizeSpeech).map(offset => {
        if (!offset) return null;
        const first = nodes.find(entry => entry.start <= offset.start && entry.end > offset.start);
        const last = nodes.find(entry => entry.start < offset.end && entry.end >= offset.end);
        if (!first || !last) return null;
        const range = this.container.ownerDocument.createRange();
        range.setStart(first.node, offset.start - first.start); range.setEnd(last.node, offset.end - last.start);
        return range;
      });
      this.container.dataset.readerMapped = String(this.ranges.filter(Boolean).length);
    }
    clear() {
      root.CSS?.highlights?.delete('qt-reading');
      if (this.block) {
        this.block.classList.remove('reader-current-block', 'reader-current-fallback');
        this.block.removeAttribute('data-reader-active');
        if (this.previousCurrent === null) this.block.removeAttribute('aria-current');
        else this.block.setAttribute('aria-current', this.previousCurrent);
      }
      this.block = null; this.index = -1;
      delete this.container.dataset.readerCurrent;
    }
    show(index) {
      if (this.index === index) return;
      this.clear();
      const range = this.ranges[index];
      if (!range || !this.container.contains(range.startContainer) || !this.container.contains(range.endContainer)) return;
      this.index = index;
      this.container.dataset.readerCurrent = String(index + 1);
      const block = range.startContainer.parentElement.closest('p,li,td,th,h1,h2,h3,h4,h5,h6,blockquote,div');
      this.block = block && this.container.contains(block) ? block : this.container;
      this.previousCurrent = this.block.getAttribute('aria-current');
      this.block.setAttribute('aria-current', 'true'); this.block.setAttribute('data-reader-active', 'true');
      this.block.classList.add('reader-current-block');
      if (root.CSS?.highlights && typeof root.Highlight === 'function') root.CSS.highlights.set('qt-reading', new root.Highlight(range));
      else this.block.classList.add('reader-current-fallback');
    }
  }
  if (typeof module !== 'undefined') module.exports = { mapSpeech, locateChunks, ReadingHighlight };
  else root.QTReadingHighlight = ReadingHighlight;
})(typeof window !== 'undefined' ? window : this);
