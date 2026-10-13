// Turns any song into a 4-lane rhythm chart.
// 1) spectral flux onset envelope (FFT 1024, hop 256 @ 22 050 Hz);
// 2) tempo by autocorrelation (70–180 BPM, preferring ~120);
// 3) beat tracking that follows small tempo drift;
// 4) notes on beats / 8ths / 16ths that carry real onsets; lane = brightness of the sound.
(function (root) {
  'use strict';
  const N = 1024, HOP = 256;

  function fft(re, im) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit;
      if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
      for (let i = 0; i < n; i += len) {
        let cr = 1, ci = 0;
        for (let k = 0; k < len / 2; k++) {
          const a = i + k, b = a + len / 2;
          const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
          re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
          const ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr;
        }
      }
    }
  }

  // Async so the UI can show progress on a phone; onProgress(0..1).
  async function analyze(samples, sr, onProgress = () => {}) {
    const frames = Math.max(0, Math.floor((samples.length - N) / HOP));
    const win = new Float32Array(N); for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N);
    const re = new Float32Array(N), im = new Float32Array(N);
    const bins = N / 2, prev = new Float32Array(bins);
    const flux = new Float32Array(frames), cent = new Float32Array(frames), energy = new Float32Array(frames);
    const maxBin = Math.floor(8000 / (sr / N));
    for (let f = 0; f < frames; f++) {
      const o = f * HOP;
      for (let i = 0; i < N; i++) { re[i] = samples[o + i] * win[i]; im[i] = 0; }
      fft(re, im);
      let fl = 0, num = 0, den = 0, en = 0;
      for (let k = 1; k < maxBin; k++) {
        const m = Math.log1p(10 * Math.hypot(re[k], im[k]));
        const d = m - prev[k]; if (d > 0) fl += d;
        prev[k] = m; num += k * m; den += m; en += m;
      }
      flux[f] = fl; cent[f] = den > 0 ? num / den : 0; energy[f] = en;
      if ((f & 1023) === 0) { onProgress(f / frames * 0.8); await new Promise(r => setTimeout(r, 0)); }
    }
    const fps = sr / HOP;
    // Onset envelope: flux minus its local mean, rectified, normalised.
    const env = new Float32Array(frames), w = Math.round(0.1 * fps);
    let sum = 0;
    for (let f = 0; f < frames + w; f++) {
      if (f < frames) sum += flux[f];
      if (f - 2 * w - 1 >= 0) sum -= flux[f - 2 * w - 1];
      const c = f - w;
      if (c >= 0 && c < frames) { const lo = Math.max(0, c - w), hi = Math.min(frames - 1, c + w); env[c] = Math.max(0, flux[c] - sum / (hi - lo + 1)); }
    }
    let mx = 0; for (let i = 0; i < frames; i++) mx = Math.max(mx, env[i]);
    if (mx > 0) for (let i = 0; i < frames; i++) env[i] /= mx;
    onProgress(0.85);

    // Tempo: autocorrelation, weighted towards ~120 BPM (log-gaussian) to avoid half/double tempo picks.
    const minLag = Math.floor(fps * 60 / 180), maxLag = Math.ceil(fps * 60 / 70);
    let bestLag = minLag, bestScore = -1;
    const ac = [];
    const acAt = lag => {
      if (lag < 1 || lag >= frames) return 0;
      if (ac[lag] !== undefined && ac[lag] !== 0) return ac[lag];
      let s = 0; for (let i = 0; i + lag < frames; i++) s += env[i] * env[i + lag];
      return (ac[lag] = s / (frames - lag));
    };
    for (let lag = minLag; lag <= maxLag + 1; lag++) acAt(lag);
    // Comb over multiples of the period: the true beat repeats at 2x and 4x as well,
    // which rules out the 2/3 and 3/4 look-alikes that a single lag picks up.
    for (let lag = minLag; lag <= maxLag; lag++) {
      const bpm = 60 * fps / lag, wgt = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 120) / 0.9, 2));
      const comb = acAt(lag) + 0.5 * acAt(2 * lag) + 0.33 * acAt(4 * lag) + 0.25 * (acAt(Math.round(lag / 2)));
      const s = comb * wgt;
      if (s > bestScore) { bestScore = s; bestLag = lag; }
    }
    // parabolic refinement for a fractional period
    const a = ac[bestLag - 1] || 0, b = ac[bestLag], c = ac[bestLag + 1] || 0;
    const shift = (a - 2 * b + c) !== 0 ? 0.5 * (a - c) / (a - 2 * b + c) : 0;
    const period = bestLag + Math.max(-0.5, Math.min(0.5, shift));
    const bpm = 60 * fps / period;

    // Phase: the offset whose beat grid collects the most onset energy.
    let bestPhase = 0, bestPS = -1;
    for (let ph = 0; ph < period; ph++) {
      let s = 0; for (let t = ph; t < frames; t += period) s += env[Math.round(t)] || 0;
      if (s > bestPS) { bestPS = s; bestPhase = ph; }
    }
    // Beat tracking: walk the grid, nudging each beat to the strongest onset within ±7% of a period.
    const beats = [];
    const tol = Math.max(2, Math.round(period * 0.07));
    for (let t = bestPhase; t < frames; ) {
      let best = Math.round(t), bv = -1;
      for (let d = -tol; d <= tol; d++) { const i = Math.round(t) + d; if (i >= 0 && i < frames && env[i] > bv) { bv = env[i]; best = i; } }
      const pos = bv > 0.15 ? best : Math.round(t);
      beats.push(pos);
      t = pos + period;
    }
    onProgress(0.95);
    // Onset peaks with strength and brightness.
    const onsets = [];
    const pw = Math.round(0.05 * fps);
    for (let f = 1; f < frames - 1; f++) {
      if (env[f] < 0.08) continue;
      let peak = true; for (let d = -pw; d <= pw; d++) { if (d && env[f + d] > env[f]) { peak = false; break; } }
      if (peak) onsets.push({ t: f / fps, s: env[f], c: cent[f] });
    }
    onProgress(1);
    // A frame "hears" an onset around the window centre, not its start.
    const lag0 = (N / 2) / sr;
    onsets.forEach(o => { o.t += lag0; });
    return { bpm: Math.round(bpm * 10) / 10, beats: beats.map(f => f / fps + lag0), onsets, duration: samples.length / sr };
  }

  // diff: 0 beats only, 1 + 8ths, 2 + 16ths and doubles.
  function chart(an, diff) {
    const { beats, onsets, duration } = an;
    const quant = q => { const s = onsets.map(o => o.s).sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : 0; };
    const near = (t, w) => { let best = null; for (const o of onsets) { if (o.t < t - w) continue; if (o.t > t + w) break; if (!best || o.s > best.s) best = o; } return best; };
    const cands = [];
    const subs = diff === 0 ? [0] : diff === 1 ? [0, 0.5] : [0, 0.25, 0.5, 0.75];
    const thr = [quant(0.35), quant(0.55), quant(0.5)][diff];
    for (let i = 0; i < beats.length - 1; i++) {
      const b0 = beats[i], p = beats[i + 1] - b0;
      for (const sub of subs) {
        const t = b0 + sub * p;
        if (t < 1.2 || t > duration - 0.6) continue;
        const o = near(t, Math.min(0.06, p * 0.12));
        const need = sub === 0 ? thr * 0.8 : sub === 0.5 ? thr : thr * 1.25;
        if (o && o.s >= need) cands.push({ t, s: o.s, c: o.c, beat: sub === 0 });
      }
    }
    if (!cands.length) return [];
    // Lane by brightness, split by quantiles so all lanes get used.
    const cs = cands.map(n => n.c).sort((a, b) => a - b);
    const q = [cs[Math.floor(cs.length * 0.25)], cs[Math.floor(cs.length * 0.5)], cs[Math.floor(cs.length * 0.75)]];
    const notes = [], last = [-9, -9, -9, -9];
    const minGap = beats.length > 1 ? (beats[beats.length - 1] - beats[0]) / (beats.length - 1) * 0.45 : 0.25;
    const strong = quant(0.9);
    for (const n of cands) {
      let lane = n.c < q[0] ? 0 : n.c < q[1] ? 1 : n.c < q[2] ? 2 : 3;
      if (n.t - last[lane] < minGap) {
        const alt = [0, 1, 2, 3].sort((a, b) => Math.abs(a - lane) - Math.abs(b - lane)).find(l => n.t - last[l] >= minGap);
        if (alt === undefined) continue; lane = alt;
      }
      notes.push({ t: n.t, lane, hit: null }); last[lane] = n.t;
      if (diff === 2 && n.beat && n.s >= strong) {
        const l2 = lane < 2 ? 3 : 0;
        if (n.t - last[l2] >= minGap) { notes.push({ t: n.t, lane: l2, hit: null }); last[l2] = n.t; }
      }
    }
    return notes.sort((a, b) => a.t - b.t);
  }

  const api = { analyze, chart };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Beatmap = api;
})(typeof self !== 'undefined' ? self : this);
