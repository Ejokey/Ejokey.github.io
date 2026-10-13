// Игротека — shared runtime: synthesized sound, haptics, records, particles, screen shake, canvas fit.
(function () {
  'use strict';
  const G = (window.G = {});

  /* ---------- storage ---------- */
  const NS = 'igra.';
  G.get = (k, d) => { try { const v = localStorage.getItem(NS + k); return v == null ? d : JSON.parse(v); } catch { return d; } };
  G.set = (k, v) => { try { localStorage.setItem(NS + k, JSON.stringify(v)); } catch {} };
  // Saves a record if it beats the old one. lowerIsBetter for times/attempts.
  G.best = (key, value, lowerIsBetter) => {
    const old = G.get('best.' + key, null);
    const better = old == null || (lowerIsBetter ? value < old : value > old);
    if (better) G.set('best.' + key, value);
    return { best: better ? value : old, isNew: better && old != null, first: old == null };
  };

  /* ---------- settings ---------- */
  G.sound = G.get('sound', true);
  G.haptics = G.get('haptics', true);
  G.toggleSound = () => { G.sound = !G.sound; G.set('sound', G.sound); return G.sound; };

  /* ---------- haptics ---------- */
  G.buzz = p => { if (G.haptics && navigator.vibrate) try { navigator.vibrate(p); } catch {} };

  /* ---------- audio: everything is synthesized, no files ---------- */
  let ctx = null, master = null, noiseBuf = null;
  function audio() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain(); master.gain.value = 0.55;
      const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -12; comp.ratio.value = 6;
      master.connect(comp); comp.connect(ctx.destination);
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.6, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }
  G.unlock = () => { try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch {} audio(); };
  addEventListener('pointerdown', G.unlock, { once: true, capture: true });

  function tone({ f = 440, f2, type = 'sine', t = 0.12, v = 0.5, at = 0, attack = 0.004 }) {
    const c = audio(); if (!c) return;
    const now = c.currentTime + at;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(f, now);
    if (f2) o.frequency.exponentialRampToValueAtTime(Math.max(20, f2), now + t);
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(v, now + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, now + t);
    o.connect(g); g.connect(master); o.start(now); o.stop(now + t + 0.02);
  }
  function noise({ t = 0.15, v = 0.4, at = 0, hp = 800, lp = 8000, f2 }) {
    const c = audio(); if (!c) return;
    const now = c.currentTime + at;
    const s = c.createBufferSource(); s.buffer = noiseBuf;
    const h = c.createBiquadFilter(); h.type = 'highpass'; h.frequency.value = hp;
    const l = c.createBiquadFilter(); l.type = 'lowpass'; l.frequency.setValueAtTime(lp, now);
    if (f2) l.frequency.exponentialRampToValueAtTime(f2, now + t);
    const g = c.createGain(); g.gain.setValueAtTime(v, now); g.gain.exponentialRampToValueAtTime(0.0001, now + t);
    s.connect(h); h.connect(l); l.connect(g); g.connect(master); s.start(now); s.stop(now + t + 0.02);
  }

  const SFX = {
    tap: () => tone({ f: 660, f2: 880, type: 'triangle', t: 0.06, v: 0.25 }),
    hit: (k = 0.5) => { tone({ f: 180 + 260 * k, f2: 90, type: 'square', t: 0.07, v: 0.18 + 0.3 * k }); noise({ t: 0.05, v: 0.15 + 0.3 * k, hp: 2000 }); },
    wall: (k = 0.5) => tone({ f: 260 + 120 * k, f2: 140, type: 'triangle', t: 0.06, v: 0.12 + 0.25 * k }),
    goal: () => { [523, 659, 784, 1047].forEach((f, i) => tone({ f, type: 'square', t: 0.16, v: 0.22, at: i * 0.07 })); noise({ t: 0.6, v: 0.25, hp: 400, lp: 6000, f2: 800, at: 0.05 }); },
    whistle: () => { tone({ f: 2400, type: 'sine', t: 0.12, v: 0.25 }); tone({ f: 2500, type: 'sine', t: 0.35, v: 0.3, at: 0.15 }); },
    kick: () => { tone({ f: 120, f2: 50, type: 'sine', t: 0.12, v: 0.7 }); noise({ t: 0.06, v: 0.4, hp: 300, lp: 3000 }); },
    save: () => { tone({ f: 200, f2: 120, type: 'sawtooth', t: 0.2, v: 0.3 }); noise({ t: 0.12, v: 0.4, hp: 500 }); },
    miss: () => tone({ f: 330, f2: 110, type: 'sawtooth', t: 0.45, v: 0.25 }),
    swish: () => noise({ t: 0.35, v: 0.35, hp: 1500, lp: 9000, f2: 2000 }),
    rim: () => { tone({ f: 900, type: 'triangle', t: 0.25, v: 0.25 }); tone({ f: 1350, type: 'sine', t: 0.2, v: 0.12 }); },
    bounce: () => tone({ f: 110, f2: 70, type: 'sine', t: 0.1, v: 0.5 }),
    throw: () => noise({ t: 0.18, v: 0.25, hp: 600, lp: 4000, f2: 1200 }),
    key: () => tone({ f: 1200, type: 'square', t: 0.025, v: 0.08 }),
    flip: (i = 0) => tone({ f: 500 + i * 90, f2: 700 + i * 90, type: 'triangle', t: 0.08, v: 0.2 }),
    error: () => { tone({ f: 160, type: 'square', t: 0.09, v: 0.2 }); tone({ f: 120, type: 'square', t: 0.12, v: 0.2, at: 0.1 }); },
    win: () => [523, 659, 784, 1047, 1319].forEach((f, i) => tone({ f, type: 'triangle', t: 0.22, v: 0.25, at: i * 0.09 })),
    lose: () => [392, 330, 262, 196].forEach((f, i) => tone({ f, type: 'triangle', t: 0.3, v: 0.22, at: i * 0.14 })),
    card: () => noise({ t: 0.05, v: 0.25, hp: 2500, lp: 9000 }),
    chips: (i = 0) => tone({ f: 600 * Math.pow(1.06, i), type: 'square', t: 0.05, v: 0.12 }),
    mult: (i = 0) => { tone({ f: 300 * Math.pow(1.09, i), f2: 600 * Math.pow(1.09, i), type: 'sawtooth', t: 0.09, v: 0.16 }); },
    coin: () => { tone({ f: 988, type: 'square', t: 0.06, v: 0.15 }); tone({ f: 1319, type: 'square', t: 0.18, v: 0.15, at: 0.06 }); },
    // pentatonic bell that climbs with i: a run of perfect moves plays a little melody
    note: (i = 0) => { const P = [0, 2, 4, 7, 9], f = 392 * Math.pow(2, (P[i % 5] + 12 * Math.floor(i / 5)) / 12); tone({ f: Math.min(f, 3200), type: 'triangle', t: 0.35, v: 0.28 }); tone({ f: Math.min(f * 2, 6400), type: 'sine', t: 0.25, v: 0.1 }); },
    slice: () => { noise({ t: 0.09, v: 0.3, hp: 1200, lp: 7000, f2: 2500 }); tone({ f: 220, f2: 140, type: 'square', t: 0.06, v: 0.12 }); },
    beep: (hi = false) => tone({ f: hi ? 1320 : 880, type: 'square', t: hi ? 0.18 : 0.08, v: 0.18 }),
    boom: () => { tone({ f: 90, f2: 30, type: 'sine', t: 0.5, v: 0.8 }); noise({ t: 0.5, v: 0.5, hp: 60, lp: 2000, f2: 100 }); },
  };
  G.sfx = (name, ...a) => { if (!G.sound) return; try { SFX[name] && SFX[name](...a); } catch {} };

  /* ---------- screen wake lock while a match runs ---------- */
  let lock = null;
  G.dpr = () => Math.min(window.devicePixelRatio || 1, 2);
  G.wake = async on => {
    try {
      if (on && !lock && navigator.wakeLock) { lock = await navigator.wakeLock.request('screen'); lock.addEventListener('release', () => { lock = null; }); }
      if (!on && lock) { await lock.release(); lock = null; }
    } catch {}
  };

  /* ---------- canvas helpers ---------- */
  G.fit = canvas => {
    const dpr = G.dpr();
    const w = canvas.clientWidth, h = canvas.clientHeight;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    const c = canvas.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { w, h, dpr, ctx: c };
  };
  // Static backgrounds are painted once into an offscreen canvas (with a 20px margin for screen shake)
  // and blitted every frame: on phones the per-pixel fill of gradients is what costs frame time.
  const layers = new Map();
  G.layer = (key, w, h, paint) => {
    const id = key + '|' + w + 'x' + h;
    let c = layers.get(id);
    if (!c) {
      const dpr = G.dpr(); c = document.createElement('canvas');
      c.width = Math.round((w + 40) * dpr); c.height = Math.round((h + 40) * dpr);
      const x = c.getContext('2d'); x.setTransform(dpr, 0, 0, dpr, 20 * dpr, 20 * dpr); paint(x);
      if (layers.size > 12) layers.clear();
      layers.set(id, c);
    }
    return c;
  };
  G.blit = (ctx, layer, w, h) => ctx.drawImage(layer, -20, -20, w + 40, h + 40);
  G.reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Particles: cheap squares/circles with gravity and fade.
  G.Particles = class {
    constructor() { this.list = []; }
    emit(x, y, { n = 12, color = '#fff', speed = 240, life = 0.6, size = 5, gravity = 300, spread = Math.PI * 2, angle = 0, shape = 'circle' } = {}) {
      if (G.reduced) n = Math.ceil(n / 3);
      for (let i = 0; i < n; i++) {
        const a = angle + (Math.random() - 0.5) * spread, v = speed * (0.35 + Math.random() * 0.65);
        this.list.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life, max: life, size: size * (0.6 + Math.random() * 0.8), color: Array.isArray(color) ? color[i % color.length] : color, gravity, shape, rot: Math.random() * 6 });
      }
    }
    update(dt) {
      for (const p of this.list) { p.life -= dt; p.vy += p.gravity * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.985; p.rot += dt * 8; }
      this.list = this.list.filter(p => p.life > 0);
    }
    draw(c) {
      for (const p of this.list) {
        c.globalAlpha = Math.max(0, p.life / p.max); c.fillStyle = p.color;
        if (p.shape === 'rect') { c.save(); c.translate(p.x, p.y); c.rotate(p.rot); c.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2); c.restore(); }
        else { c.beginPath(); c.arc(p.x, p.y, p.size * (0.4 + 0.6 * p.life / p.max), 0, 7); c.fill(); }
      }
      c.globalAlpha = 1;
    }
  };

  // Screen shake with exponential decay.
  G.Shake = class {
    constructor() { this.a = 0; }
    add(v) { if (!G.reduced) this.a = Math.min(30, this.a + v); }
    update(dt) { this.a *= Math.pow(0.0015, dt); if (this.a < 0.2) this.a = 0; }
    get x() { return (Math.random() - 0.5) * this.a; }
    get y() { return (Math.random() - 0.5) * this.a; }
  };

  // Fixed-step-ish game loop that pauses in background tabs.
  G.loop = fn => {
    let last = performance.now(), id = 0, running = true;
    const step = t => { if (!running) return; const dt = Math.min(0.033, (t - last) / 1000); last = t; fn(dt, t / 1000); id = requestAnimationFrame(step); };
    id = requestAnimationFrame(step);
    return { stop() { running = false; cancelAnimationFrame(id); }, start() { if (!running) { running = true; last = performance.now(); id = requestAnimationFrame(step); } } };
  };

  G.toast = msg => {
    let t = document.querySelector('.toast');
    if (!t) { t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
    t.textContent = msg; t.classList.add('show'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 1600);
  };

  // Shared top bar: back to the menu + sound toggle.
  G.ICONS = {
    back: '<svg class="i" viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>',
    on: '<svg class="i" viewBox="0 0 24 24"><path d="M11 5 6 9H3v6h3l5 4V5Z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/></svg>',
    off: '<svg class="i" viewBox="0 0 24 24"><path d="M11 5 6 9H3v6h3l5 4V5Z"/><path d="M22 9l-6 6M16 9l6 6"/></svg>',
    pause: '<svg class="i" viewBox="0 0 24 24"><path d="M9 5v14M15 5v14"/></svg>',
  };
  G.topbar = (opts = {}) => {
    const bar = document.createElement('div'); bar.className = 'topbar';
    bar.innerHTML = `<a class="round" href="./" aria-label="В меню">${G.ICONS.back}</a><span class="spacer"></span>` +
      (opts.pause ? `<button class="round" type="button" data-pause aria-label="Пауза">${G.ICONS.pause}</button>` : '') +
      `<button class="round" type="button" data-sound aria-label="Звук">${G.sound ? G.ICONS.on : G.ICONS.off}</button>`;
    bar.querySelector('[data-sound]').addEventListener('click', e => { const on = G.toggleSound(); e.currentTarget.innerHTML = on ? G.ICONS.on : G.ICONS.off; G.toast(on ? 'Звук включён' : 'Звук выключен'); });
    if (opts.pause) bar.querySelector('[data-pause]').addEventListener('click', opts.pause);
    document.body.appendChild(bar);
    return bar;
  };

  G.VERSION = 13;   // keep equal to the number in sw.js CACHE ('igra-v13'); shown on the hub

  // Updates: Android often resumes the app from memory instead of reloading it, so ask for a new
  // version on every open and every return to the app. When a new one takes over, the hub reloads
  // itself; inside a game we only say so, to never break a round.
  if ('serviceWorker' in navigator && window.isSecureContext && window.top === window.self) {
    const hadController = !!navigator.serviceWorker.controller;
    let reg = null, reloaded = false;
    const check = () => { if (reg && navigator.onLine) reg.update().catch(() => {}); };
    addEventListener('load', () => navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' })
      .then(r => { reg = r; check(); }).catch(() => {}));
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController || reloaded) return;   // first install: the page is already current
      reloaded = true;
      if (document.body.dataset.hub !== undefined) location.reload();
      else G.toast('Вышло обновление — вернись в меню, оно подтянется');
    });
  }
})();
