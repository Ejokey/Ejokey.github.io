// Offline Russian typo corrector for «Голос».
// ru-words.dat holds frequency bands (for ranking), Hunspell stems and suffix rules (to accept
// every inflected form without expanding them). Edit distance is weighted by the ЙЦУКЕН keyboard:
// fixes neighbour-key slips, missing/extra/swapped letters, a missing space and text typed
// in the English layout. Only unknown words are touched, so a correct rare word is never
// "fixed" into a frequent one.
(function (root) {
  'use strict';

  const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const ALPHABET = 'абвгдеёжзийклмнопрстуфхцчшщъыьэюя';
  const ROWS = ['йцукенгшщзхъ', 'фывапролджэ', 'ячсмитьбю'];
  const ROW_SHIFT = [0, 0.3, 0.8];
  const LATIN = "qwertyuiop[]asdfghjkl;'zxcvbnm,.`";
  const CYR = 'йцукенгшщзхъфывапролджэячсмитьбюё';
  const SINGLE = new Set(['в', 'к', 'с', 'у', 'и', 'а', 'о', 'я', 'ж', 'б']);
  const HYPHEN = new Set(['то', 'нибудь', 'либо', 'ка', 'таки']);

  // Common substitutions people make that are not keyboard slips.
  const SOUND_ALIKE = new Set(['ео', 'ое', 'ао', 'оа', 'ая', 'яа', 'ие', 'еи', 'иы', 'ыи', 'ий', 'йи',
    'ьъ', 'ъь', 'еэ', 'эе', 'шщ', 'щш', 'юу', 'ую', 'зс', 'сз', 'тд', 'дт', 'бп', 'пб']);

  const pos = {};
  ROWS.forEach((r, y) => [...r].forEach((ch, x) => { pos[ch] = [x + ROW_SHIFT[y], y]; }));
  pos['ё'] = pos['е'];
  function subCost(a, b) {
    if ((a === 'е' && b === 'ё') || (a === 'ё' && b === 'е')) return 0.1;
    const pa = pos[a], pb = pos[b];
    if (pa && pb && Math.hypot(pa[0] - pb[0], pa[1] - pb[1]) < 1.35) return 0.5;
    if (SOUND_ALIKE.has(a + b)) return 0.6;
    return 1;
  }

  const norm = w => w.replace(/ё/g, 'е');
  let band = null;        // normalized word -> frequency band (0 = most frequent)
  let best = null;        // normalized word -> spelling with ё where the dictionary has it
  let stems = null;       // Hunspell stem -> flags
  let rulesByAdd = null;  // suffix -> [{flag, strip, re}]
  let maxAdd = 0;
  const RARE = 30;        // band for valid words outside the frequency list
  const learned = new Set();
  const cache = new Map();

  function load(text) {
    band = new Map(); best = new Map(); stems = new Map(); rulesByAdd = new Map(); maxAdd = 0;
    let b = 0, prev = '', inStems = false;
    for (const line of text.split('\n')) {
      if (!line) continue;
      if (line.startsWith('@rules ')) {
        for (const [flag, strip, add, cond] of JSON.parse(line.slice(7))) {
          if (!rulesByAdd.has(add)) rulesByAdd.set(add, []);
          rulesByAdd.get(add).push({ flag, strip, re: new RegExp((cond === '.' ? '' : cond) + '$') });
          maxAdd = Math.max(maxAdd, add.length);
        }
        continue;
      }
      if (line === '@stems') { inStems = true; prev = ''; continue; }
      if (line[0] === '#') { const n = parseInt(line.slice(1), 10); if (!isNaN(n)) b = n; prev = ''; continue; }
      const raw = prev.slice(0, DIGITS.indexOf(line[0])) + line.slice(1);
      if (inStems) {
        const slash = raw.indexOf('/');
        const w = slash === -1 ? raw : raw.slice(0, slash);
        stems.set(w, slash === -1 ? '' : raw.slice(slash + 1));
        prev = w;
        continue;
      }
      prev = raw;
      const k = norm(raw);
      if (!band.has(k)) { band.set(k, b); best.set(k, raw); }
    }
    cache.clear(); validCache.clear();
    return band.size + stems.size;
  }

  // Hunspell check without expanding forms: strip each possible suffix and look the stem up.
  const validCache = new Map();
  const cap = w => w[0].toUpperCase() + w.slice(1);
  function hunValid(k) {
    if (!stems || !k) return false;
    if (validCache.has(k)) return validCache.get(k);
    let ok = stems.has(k) || stems.has(cap(k));
    for (let i = 1; !ok && i <= Math.min(maxAdd, k.length - 1); i++) {
      const rs = rulesByAdd.get(k.slice(k.length - i));
      if (!rs) continue;
      const base = k.slice(0, k.length - i);
      for (const r of rs) {
        const stem = base + r.strip;
        if (!r.re.test(stem)) continue;
        const fl = stems.get(stem) ?? stems.get(cap(stem));
        if (fl && fl.includes(r.flag)) { ok = true; break; }
      }
    }
    // Rules with an empty suffix (the stem changes but nothing is added).
    if (!ok && rulesByAdd.has('')) {
      for (const r of rulesByAdd.get('')) {
        const stem = k + r.strip; if (!r.re.test(stem)) continue;
        const fl = stems.get(stem) ?? stems.get(cap(stem));
        if (fl && fl.includes(r.flag)) { ok = true; break; }
      }
    }
    if (validCache.size > 50000) validCache.clear();
    validCache.set(k, ok);
    return ok;
  }

  // full: also ask Hunspell (slower); quick: frequency list only, for the second edit pass.
  const known = (w, quick) => { const k = norm(w); return learned.has(k) || (band && band.has(k)) || (!quick && hunValid(k)); };
  // Words the user taught count as moderately common, never above the dictionary's own rank.
  const bandOf = w => { const k = norm(w); return band.has(k) ? band.get(k) : learned.has(k) ? 16 : RARE; };

  // All single edits with their cost: Map<variant, cost>.
  function edits(w, base, out) {
    const add = (v, c) => { c += base; const o = out.get(v); if (o === undefined || c < o) out.set(v, c); };
    for (let i = 0; i <= w.length; i++) {
      const a = w.slice(0, i), b = w.slice(i);
      if (b) {
        // extra letter typed: a doubled letter or a neighbour of the next/previous key is cheap
        const extra = b[0], near = (b[1] && subCost(extra, b[1]) <= 0.5) || (a && subCost(extra, a[a.length - 1]) <= 0.5);
        add(a + b.slice(1), extra === a[a.length - 1] || extra === b[1] ? 0.4 : near ? 0.6 : 0.85);
      }
      if (b.length > 1 && b[0] !== b[1]) add(a + b[1] + b[0] + b.slice(2), 0.6);
      for (const ch of ALPHABET) {
        if (b && ch !== b[0]) add(a + ch + b.slice(1), subCost(b[0], ch));
        add(a + ch + b, 0.8); // missing letter
      }
    }
    return out;
  }

  function maxCost(len) { return len <= 3 ? 0.6 : len <= 4 ? 1 : len <= 7 ? 1.6 : 2.1; }

  function correctWord(w) {
    if (cache.has(w)) return cache.get(w);
    let res = null;
    const limit = maxCost(w.length);
    const score = (cand, cost) => cost * 3 + bandOf(cand) * 0.18;
    let bestScore = Infinity;
    const consider = (cand, cost, quick) => {
      if (cost > limit || !known(cand, quick)) return;
      const s = score(cand, cost);
      if (s < bestScore) { bestScore = s; res = best.get(norm(cand)) || cand; }
    };
    const e1 = edits(w, 0, new Map());
    for (const [v, c] of e1) consider(v, c);
    // A missing space: «какдела» -> «как дела».
    if (w.length >= 4) {
      for (let i = 1; i < w.length; i++) {
        const a = w.slice(0, i), b = w.slice(i);
        // Both halves must be common words, otherwise «дедлайн» turns into «дед лайн».
        if ((a.length > 1 || SINGLE.has(a)) && b.length > 1 && known(a) && known(b) && bandOf(a) <= 21 && bandOf(b) <= 21) {
          const s = 0.8 * 3 + (bandOf(a) + bandOf(b)) * 0.12;
          if (s < bestScore) { bestScore = s; res = (best.get(norm(a)) || a) + (HYPHEN.has(b) ? '-' : ' ') + (best.get(norm(b)) || b); }
        }
      }
    }
    if (!res && w.length >= 5) {
      const e2 = new Map();
      for (const [v, c] of e1) if (c <= 0.85) edits(v, c, e2);
      for (const [v, c] of e2) consider(v, c, true);
    }
    cache.set(w, res);
    return res;
  }

  function fromLatin(tok) {
    let out = '';
    for (const ch of tok.toLowerCase()) { const i = LATIN.indexOf(ch); out += i === -1 ? ch : CYR[i]; }
    return out;
  }

  function matchCase(src, dst) {
    if (src.length > 1 && src === src.toUpperCase() && src !== src.toLowerCase()) return dst.toUpperCase();
    if (src[0] !== src[0].toLowerCase()) return dst[0].toUpperCase() + dst.slice(1);
    return dst;
  }

  // Returns the corrected text, or the input unchanged when the dictionary is not loaded.
  function fix(text) {
    if (!band) return text;
    const TOKEN = /([a-z`\[\];',.]*[a-z][a-z`\[\];',.]*)|([а-яё]+(?:-[а-яё]+)*)/giu;
    let sentenceStart = true, last = 0, out = '';
    text.replace(TOKEN, (m, lat, cyr, at) => {
      const gap = text.slice(last, at);
      if (/[.!?…]/.test(gap)) sentenceStart = true;
      out += gap; last = at + m.length;
      let rep = m;
      if (lat) {
        // English layout by mistake: «ghbdtn» -> «привет». Real English words stay as they are.
        let core = lat, tail = '';
        const mt = lat.match(/^(.*?[a-z`\[\];'].*?)([,.;]*)$/i);
        if (mt) { core = mt[1]; tail = mt[2]; }
        for (const [c, t] of [[lat, ''], [core, tail]]) {
          const cyrW = fromLatin(c);
          if (cyrW.length >= 2 && known(cyrW)) { rep = matchCase(c, best.get(norm(cyrW)) || cyrW) + t; break; }
          if (cyrW.length >= 4) { const f = correctWord(cyrW); if (f && !f.includes(' ')) { rep = matchCase(c, f) + t; break; } }
        }
      } else {
        const lower = cyr.toLowerCase();
        const name = !sentenceStart && cyr[0] !== lower[0];
        if (!name && lower.length >= 3 && !known(lower) && !/-/.test(lower)) {
          const f = correctWord(lower);
          if (f) rep = matchCase(cyr, f);
        }
      }
      out += rep;
      sentenceStart = false;
      return m;
    });
    return out + text.slice(last);
  }

  function learn(text) {
    for (const w of (text.toLowerCase().match(/[а-яё]+(?:-[а-яё]+)*/g) || [])) if (w.length >= 3) learned.add(norm(w));
    cache.clear();
  }

  const api = { load, fix, learn, learned, get ready() { return !!band; }, correctWord, known };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Speller = api;
})(typeof self !== 'undefined' ? self : this);
