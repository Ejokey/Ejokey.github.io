import { CATS } from './phrases.js';
import { MODELS, SIZE_MB, BASIC, WHISPER } from './models.js';

/* Курс: рублей за 1 шекель. Кросс-курс ЦБ РФ (USD 83,76 ₽ на 16.10.2026)
   и Банка Израиля (USD 3,103 ₪ на 15.10.2026). В приложении можно поменять. */
const DEFAULT_RATE = 27;
const RATE_NOTE = 'Примерный курс ЦБ на 16.10.2026. В обменниках будет немного хуже.';

const $ = id => document.getElementById(id);
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
};
function toast(msg, ms = 3500) {
  const t = $('toast'); t.textContent = msg; t.classList.add('on');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('on'), ms);
}
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* ---------- офлайн: сервис-воркер ---------- */
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').then(() => navigator.serviceWorker.ready).then(() => {
    // Многопоточность включается, только когда страницу отдаёт сервис-воркер — один раз перезагружаемся.
    if (!self.crossOriginIsolated && navigator.serviceWorker.controller === null && !sessionStorage.getItem('coi')) {
      sessionStorage.setItem('coi', '1'); location.reload();
    }
  }).catch(() => {});
  // Вышла новая версия приложения — один раз перезагружаемся, чтобы не показывать старую.
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController && !sessionStorage.getItem('upd')) { sessionStorage.setItem('upd', '1'); location.reload(); return; }
    if (!self.crossOriginIsolated && !sessionStorage.getItem('coi')) { sessionStorage.setItem('coi', '1'); location.reload(); }
  });
}
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

/* ---------- модели в отдельном потоке ---------- */
const worker = new Worker('worker.js', { type: 'module' });
let seq = 0;
const waiting = new Map();
const dlListeners = new Set();
worker.onmessage = ({ data }) => {
  if (data.type) { dlListeners.forEach(f => f(data)); return; }
  const w = waiting.get(data.id); if (!w) return;
  waiting.delete(data.id);
  data.ok ? w.resolve(data.result) : w.reject(new Error(data.error));
};
function call(type, payload = {}, transfer = []) {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    waiting.set(id, { resolve, reject });
    worker.postMessage({ id, type, ...payload }, transfer);
  });
}

const ready = {};
async function checkReady() {
  let urls = [];
  try { urls = (await (await caches.open('transformers-cache')).keys()).map(r => r.url); } catch (e) {}
  for (const [key, m] of Object.entries(MODELS)) {
    ready[key] = m.files.every(f => urls.some(u => u.includes(m.id + '/') && u.endsWith(f)));
  }
  renderSetup(); renderReady();
}
const basicReady = () => BASIC.every(k => ready[k]);
const whisperReady = () => WHISPER.every(k => ready[k]);

/* ---------- скачивание ---------- */
let wakeLock = null;
async function download(keys, ui = { btn: 'dl', bar: 'dl-bar', note: 'dl-note' }) {
  const total = keys.reduce((s, k) => s + SIZE_MB[k], 0) * 1e6;
  const files = new Map();
  const bar = $(ui.bar), fill = bar.querySelector('i'), note = $(ui.note);
  if (!navigator.serviceWorker || !navigator.serviceWorker.controller) { location.reload(); return; }
  bar.hidden = false; $(ui.btn).disabled = true;
  note.textContent = 'Не закрывайте приложение и не выключайте экран.';
  try { wakeLock = await navigator.wakeLock.request('screen'); } catch (e) {}
  const onMsg = d => {
    if (d.type === 'dl-progress') {
      files.set(d.key + d.file, d.loaded);
      const got = [...files.values()].reduce((a, b) => a + b, 0);
      const pct = Math.min(99, Math.round(got / total * 100));
      fill.style.width = pct + '%';
      note.textContent = `Скачано ${Math.round(got / 1e6)} из ~${Math.round(total / 1e6)} МБ. Не закрывайте приложение.`;
    }
  };
  dlListeners.add(onMsg);
  try {
    await call('download', { keys });
    fill.style.width = '100%';
    note.textContent = 'Готово. Работает без интернета.';
    toast('Готово! Работает без интернета.');
  } catch (e) {
    note.innerHTML = `<span class="warn">Не получилось: ${esc(e.message)}.</span> Проверьте Wi-Fi и нажмите ещё раз — скачанное не пропадёт.`;
  } finally {
    dlListeners.delete(onMsg);
    $(ui.btn).disabled = false;
    try { wakeLock && wakeLock.release(); } catch (e) {}
    await checkReady();
  }
}
$('dl').addEventListener('click', () => download(BASIC.filter(k => !ready[k])));
$('dl-w').addEventListener('click', () => download(WHISPER.filter(k => !ready[k]), { btn: 'dl-w', bar: 'dlw-bar', note: 'dlw-note' }));

function renderSetup() {
  const need = BASIC.filter(k => !ready[k]);
  $('setup').hidden = need.length === 0;
  $('setup-mb').textContent = need.reduce((s, k) => s + SIZE_MB[k], 0);
  $('dock').classList.toggle('on', currentTab === 'talk' && need.length === 0);
  if (need.length === 0) warm();
}

/* ---------- голос ---------- */
let voices = [];
function loadVoices() { try { voices = speechSynthesis.getVoices() || []; } catch (e) { voices = []; } }
if ('speechSynthesis' in window) { loadVoices(); speechSynthesis.onvoiceschanged = () => { loadVoices(); renderReady(); }; }
const VOICE_RE = { he: /^(he|iw)([-_]|$)/i, ru: /^ru([-_]|$)/i, en: /^en([-_]|$)/i };
const voiceFor = lang => voices.find(v => VOICE_RE[lang].test(v.lang) && v.localService) || voices.find(v => VOICE_RE[lang].test(v.lang));
const stripNikud = s => s.replace(/[֑-ׇ]/g, '');
function speak(text, lang) {
  if (!('speechSynthesis' in window)) { toast('Телефон не умеет говорить вслух. Покажите экран.'); return; }
  loadVoices();
  const v = voiceFor(lang);
  if (!v) { toast(`Нет голоса «${{ he: 'иврит', ru: 'русский', en: 'английский' }[lang]}» в телефоне. Покажите экран.`); return; }
  try { speechSynthesis.cancel(); } catch (e) {}
  const u = new SpeechSynthesisUtterance(lang === 'he' ? stripNikud(text) : text);
  u.voice = v; u.lang = v.lang; u.rate = 0.9;
  speechSynthesis.speak(u);
}

function renderReady() {
  const row = (name, ok, okText = 'есть', noText = 'нет') =>
    `<div class="check"><span>${name}</span><span class="${ok ? 'ok' : 'no'}">${ok ? '✓ ' + okText : '✗ ' + noText}</span></div>`;
  $('ready').innerHTML =
    row('Переводчик', basicReady(), 'скачан', 'не скачан') +
    row('Распознавание в приложении', whisperReady(), 'скачано', 'не скачано') +
    row('Голос: иврит', !!voiceFor('he')) +
    row('Голос: русский', !!voiceFor('ru')) +
    row('Голос: английский', !!voiceFor('en'));
  $('dl-w').hidden = whisperReady();
  $('dlw-mb').textContent = WHISPER.filter(k => !ready[k]).reduce((s, k) => s + SIZE_MB[k], 0);
  document.querySelectorAll('#engine button').forEach(b => b.classList.toggle('on', b.dataset.e === engine));
}

/* ---------- переводчик ---------- */
let other = store.get('other') === 'en' ? 'en' : 'he';
const THEM = {
  he: { lbl: 'דברו כאן', sub: 'לחצו ודברו', stop: 'עצור', who: 'Собеседник (иврит)' },
  en: { lbl: 'Speak here', sub: 'Tap and speak', stop: 'Stop', who: 'Собеседник (англ.)' },
};
function renderOther() {
  document.querySelectorAll('#other button').forEach(b => b.classList.toggle('on', b.dataset.l === other));
  $('mic-them').querySelector('.lbl').textContent = THEM[other].lbl;
  $('mic-them').querySelector('small').textContent = THEM[other].sub;
}
$('other').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  other = b.dataset.l; store.set('other', other); renderOther(); warm();
});

let warmed = '';
function warm() {
  const sig = other + engine;
  if (warmed === sig || !basicReady()) return;
  warmed = sig;
  // Поднимаем модели заранее, чтобы первый перевод не ждал загрузки.
  const asr = engine === 'whisper' && whisperReady() ? ['asr-base', ...(other === 'he' ? ['asr-he'] : [])] : [];
  ['ru-' + other, other + '-ru', ...asr].reduce((p, key) => p.then(() => call('warm', { key }).catch(() => {})), Promise.resolve());
}

const chat = $('chat');
function addCard(side, lang) {
  $('hello').hidden = true;
  const el = document.createElement('div');
  el.className = `msg ${side} busy`;
  el.innerHTML = `<div class="who">${side === 'me' ? 'Вы' : THEM[lang].who}</div>
    <div class="src"></div><div class="dst">Слушаю…</div>`;
  chat.appendChild(el);
  el.scrollIntoView({ behavior: 'smooth', block: 'end' });
  return {
    el,
    status(t) { el.querySelector('.dst').textContent = t; },
    src(t, l) { const s = el.querySelector('.src'); s.textContent = t; s.dir = l === 'he' ? 'rtl' : 'ltr'; },
    fail(t) { el.classList.remove('busy'); el.classList.add('err'); el.querySelector('.dst').textContent = t; el.scrollIntoView({ block: 'end' }); },
    done(src, dst, toLang) {
      el.classList.remove('busy');
      const d = el.querySelector('.dst'); d.textContent = dst; d.dir = toLang === 'he' ? 'rtl' : 'ltr';
      const row = document.createElement('div'); row.className = 'row';
      row.innerHTML = `<button data-a="say">🔊 Ещё раз</button><button data-a="big">⤢ Крупно</button>`;
      row.addEventListener('click', e => {
        const a = e.target.closest('button'); if (!a) return;
        if (a.dataset.a === 'say') speak(dst, toLang);
        else openShow({ big: dst, bigLang: toLang, sub: '', hint: esc(src), sayText: dst, sayLang: toLang });
      });
      el.appendChild(row);
      el.scrollIntoView({ behavior: 'smooth', block: 'end' });
    },
  };
}

async function translateAndShow(card, text, from, to) {
  card.src(text, from);
  card.status('Перевожу…');
  const pair = from === 'ru' ? 'ru-' + to : from + '-ru';
  const out = await call('mt', { text, pair });
  if (!out) throw new Error('пустой перевод');
  card.done(text, out, to);
  speak(out, to);
}

/* ---------- распознавание речи ----------
   google  — распознаватель, встроенный в Android (через Chrome). Быстрый и лёгкий,
             но без интернета работает, только если в телефоне скачаны офлайн-языки.
   whisper — свои модели в приложении. Работает всегда, но тяжелее для слабого телефона. */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let engine = store.get('engine') || (SR ? 'google' : 'whisper');
if (!SR) engine = 'whisper';
function setEngine(e) { engine = e; store.set('engine', e); renderReady(); warm(); }
$('engine').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.e === 'google' && !SR) { toast('В этом браузере нет распознавания Google. Откройте в Chrome.'); return; }
  setEngine(b.dataset.e);
});
const SR_LANG = { ru: 'ru-RU', he: 'he-IL', en: 'en-US' };
const SR_OFFLINE = ['network', 'service-not-allowed', 'language-not-supported'];

// Одна попытка распознать фразу через Google. onText — промежуточный текст для показа.
function googleListen(lang, onText) {
  const r = new SR();
  r.lang = SR_LANG[lang]; r.interimResults = true; r.continuous = false; r.maxAlternatives = 1;
  let final = '', interim = '', error = null, heard = false, ended = false;
  const done = new Promise(resolve => {
    const finish = () => { if (ended) return; ended = true; clearTimeout(t1); clearTimeout(t2); resolve({ text: (final || interim).trim(), error }); };
    // Сторож: если распознаватель молчит (так бывает без сети) — не висим вечно.
    const t1 = setTimeout(() => { if (!heard) { error = error || 'network'; try { r.abort(); } catch (e) {} finish(); } }, 7000);
    const t2 = setTimeout(() => { try { r.stop(); } catch (e) {} setTimeout(finish, 1500); }, 30000);
    r.onaudiostart = r.onspeechstart = () => { heard = true; };
    r.onresult = e => {
      heard = true;
      interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) final += e.results[i][0].transcript; else interim += e.results[i][0].transcript;
      }
      onText && onText((final + ' ' + interim).trim());
    };
    r.onerror = e => { error = e.error || 'error'; };
    r.onend = finish;
  });
  try { r.start(); } catch (e) { error = 'network'; }
  return { stop: () => { try { r.stop(); } catch (e) {} }, done };
}
function googleErrorText(err) {
  if (err === 'no-speech') return 'Ничего не слышно. Нажмите и говорите ближе к телефону.';
  if (err === 'not-allowed' || err === 'audio-capture') return 'Нет доступа к микрофону. Разрешите его в настройках браузера.';
  if (SR_OFFLINE.includes(err)) return 'Распознавание Google без интернета не сработало.';
  return 'Не разобрал (' + err + '). Попробуйте ещё раз.';
}

/* запись с микрофона */
let rec = null;            // whisper: { side, recorder, stream, chunks, timer }; google: { side, google, card }
let busy = false;
function setMics() {
  const me = $('mic-me'), them = $('mic-them');
  me.classList.toggle('rec', rec?.side === 'me');
  them.classList.toggle('rec', rec?.side === 'them');
  me.disabled = busy || (rec && rec.side !== 'me');
  them.disabled = busy || (rec && rec.side !== 'them');
  me.querySelector('.lbl').textContent = rec?.side === 'me' ? 'Стоп' : 'Я говорю';
  me.querySelector('small').textContent = rec?.side === 'me' ? 'нажмите, когда договорите' : 'по-русски';
  them.querySelector('.lbl').textContent = rec?.side === 'them' ? THEM[other].stop : THEM[other].lbl;
  them.querySelector('small').textContent = rec?.side === 'them' ? '' : THEM[other].sub;
}

async function startRec(side) {
  if (!basicReady()) { toast('Сначала скачайте переводчик.'); return; }
  try { speechSynthesis.cancel(); } catch (e) {}
  if (engine === 'google' && SR) return startGoogle(side);
  if (!whisperReady()) { toast('Распознавание в приложении не скачано. Скачайте его в «Справке» или выберите Google.'); return; }
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  } catch (e) {
    toast('Нет доступа к микрофону. Разрешите его в настройках браузера.'); return;
  }
  const recorder = new MediaRecorder(stream);
  const chunks = [];
  recorder.ondataavailable = e => e.data.size && chunks.push(e.data);
  recorder.start();
  rec = { side, recorder, stream, chunks, timer: setTimeout(() => stopRec(), 30000) };
  setMics();
  if (navigator.vibrate) navigator.vibrate(30);
}

async function startGoogle(side) {
  const from = side === 'me' ? 'ru' : other;
  const to = side === 'me' ? other : 'ru';
  const card = addCard(side, other);
  const google = googleListen(from, t => card.src(t, from));
  rec = { side, google, card };
  setMics();
  if (navigator.vibrate) navigator.vibrate(30);
  const { text, error } = await google.done;        // сам заканчивает, когда человек замолчал
  rec = null; busy = true; setMics();
  try {
    if (!text) {
      if (SR_OFFLINE.includes(error) && whisperReady()) {
        setEngine('whisper');
        card.fail('Google без интернета не работает — переключил на распознавание в приложении. Нажмите кнопку ещё раз.');
      } else if (SR_OFFLINE.includes(error)) {
        card.fail('Google без интернета не работает. Напишите текстом (можно через 🎤 на клавиатуре) или скачайте распознавание в «Справке».');
      } else card.fail(googleErrorText(error || 'no-speech'));
      return;
    }
    await translateAndShow(card, text, from, to);
  } catch (e) {
    card.fail('Ошибка: ' + e.message);
  } finally {
    busy = false; setMics();
  }
}

async function stopRec() {
  if (!rec) return;
  if (rec.google) { rec.google.stop(); return; }    // дальше всё сделает startGoogle
  const { side, recorder, stream, chunks, timer } = rec;
  clearTimeout(timer);
  rec = null; busy = true; setMics();
  const stopped = new Promise(r => recorder.onstop = r);
  recorder.stop(); await stopped;
  stream.getTracks().forEach(t => t.stop());

  const from = side === 'me' ? 'ru' : other;
  const to = side === 'me' ? other : 'ru';
  const card = addCard(side, other);
  try {
    card.status('Распознаю…');
    const audio = await decode(new Blob(chunks, { type: recorder.mimeType }));
    if (audio.length < 16000 * 0.4 || rms(audio) < 0.004) { card.fail('Ничего не слышно. Нажмите и говорите ближе к телефону.'); return; }
    const text = await call('asr', { audio, lang: from }, [audio.buffer]);
    if (!text) { card.fail('Не разобрал. Попробуйте ещё раз, чуть громче и медленнее.'); return; }
    await translateAndShow(card, text, from, to);
  } catch (e) {
    card.fail('Ошибка: ' + e.message);
  } finally {
    busy = false; setMics();
  }
}

async function decode(blob) {
  const ctx = new AudioContext({ sampleRate: 16000 });
  try {
    const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
    if (buf.numberOfChannels === 1) return new Float32Array(buf.getChannelData(0));
    const a = buf.getChannelData(0), b = buf.getChannelData(1), out = new Float32Array(a.length);
    for (let i = 0; i < a.length; i++) out[i] = (a[i] + b[i]) / 2;
    return out;
  } finally { ctx.close(); }
}
function rms(a) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * a[i]; return Math.sqrt(s / a.length); }

$('mic-me').addEventListener('click', () => rec ? stopRec() : startRec('me'));
$('mic-them').addEventListener('click', () => rec ? stopRec() : startRec('them'));

/* проверка Google-распознавания: в режиме полёта */
$('sr-test').addEventListener('click', async e => {
  const b = e.target.closest('button'); if (!b || !SR) { if (!SR) toast('В этом браузере нет распознавания Google.'); return; }
  const lang = b.dataset.l, out = $('sr-out');
  // Где браузер умеет ставить языки для офлайна (новый Chrome) — просим поставить.
  try {
    if (SR.available) {
      const st = await SR.available({ langs: [SR_LANG[lang]], processLocally: true });
      if (st === 'downloadable' && navigator.onLine) { out.textContent = 'Скачиваю язык для офлайна…'; await SR.install({ langs: [SR_LANG[lang]], processLocally: true }); }
    }
  } catch (err) {}
  out.textContent = 'Говорите…';
  const { text, error } = await googleListen(lang, t => { out.textContent = t; }).done;
  out.innerHTML = text
    ? `<span class="ok">✓ Работает${navigator.onLine ? ' (но интернет включён — проверьте в режиме полёта)' : ' без интернета'}:</span> ${esc(text)}`
    : `<span class="no">✗ ${esc(googleErrorText(error || 'no-speech'))}</span>`;
});

/* набор текстом (в том числе голосом с клавиатуры) */
async function sendTyped() {
  const text = $('typed').value.trim();
  if (!text || busy) return;
  if (!basicReady()) { toast('Сначала скачайте переводчик.'); return; }
  const from = /[֐-׿]/.test(text) ? 'he' : /[а-яё]/i.test(text) ? 'ru' : 'en';
  const to = from === 'ru' ? other : 'ru';
  const side = from === 'ru' ? 'me' : 'them';
  $('typed').value = '';
  busy = true; setMics();
  const card = addCard(side, from === 'ru' ? other : from);
  try { await translateAndShow(card, text, from, to); }
  catch (e) { card.fail('Ошибка: ' + e.message); }
  finally { busy = false; setMics(); }
}
$('send').addEventListener('click', sendTyped);
$('typed').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendTyped(); } });

/* ---------- крупный показ ---------- */
let shownNow = null;
function openShow(o) {
  shownNow = o;
  const big = $('s-big'); big.textContent = o.big; big.dir = o.bigLang === 'he' ? 'rtl' : 'ltr';
  $('s-sub').textContent = o.sub || '';
  $('s-hint').innerHTML = o.hint || '';
  $('show').classList.add('on');
  history.pushState({ show: 1 }, '');
}
function closeShow() { $('show').classList.remove('on'); try { speechSynthesis.cancel(); } catch (e) {} }
$('s-close').addEventListener('click', () => { if (history.state && history.state.show) history.back(); else closeShow(); });
window.addEventListener('popstate', closeShow);
$('s-speak').addEventListener('click', () => shownNow && speak(shownNow.sayText, shownNow.sayLang));

/* ---------- фразы ---------- */
let gender = store.get('g') === 'f' ? 'f' : 'm';
let cat = 'basic', query = '', shown = [];
const pick = v => Array.isArray(v) ? v[gender === 'f' ? 1 : 0] : v;
const heOf = p => gender === 'f' && p.he_f ? p.he_f : pick(p.he);
const trOf = p => gender === 'f' && p.tr_f ? p.tr_f : pick(p.tr);

function renderGender() { document.querySelectorAll('#gender button').forEach(b => b.classList.toggle('on', b.dataset.g === gender)); }
$('gender').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  gender = b.dataset.g; store.set('g', gender); renderGender(); renderList();
});
function renderCats() {
  $('cats').innerHTML = CATS.map(c => `<button data-c="${c.id}" class="${c.id === cat && !query ? 'on' : ''}">${c.name}</button>`).join('');
}
$('cats').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  cat = b.dataset.c; query = ''; $('search').value = ''; renderCats(); renderList(); window.scrollTo({ top: 0 });
});
function renderList() {
  const q = query.trim().toLowerCase();
  if (q) {
    const seen = new Set(); shown = [];
    CATS.forEach(c => c.items.forEach(p => {
      const key = pick(p.ru) + p.en;
      if (!seen.has(key) && (pick(p.ru) + ' ' + c.name + ' ' + p.en).toLowerCase().includes(q)) { seen.add(key); shown.push(p); }
    }));
  } else shown = CATS.find(c => c.id === cat).items;
  $('list').innerHTML = shown.length ? shown.map((p, i) => `
    <button class="phrase" data-i="${i}">
      <div class="ru">${pick(p.ru)}</div>
      <div class="he">${heOf(p)}</div>
      <div class="tr">${trOf(p)}</div>
    </button>`).join('') : `<div class="empty">Ничего не нашлось. Попробуйте другое слово или спросите через «Переводчик».</div>`;
}
$('search').addEventListener('input', e => { query = e.target.value; renderCats(); renderList(); });
$('list').addEventListener('click', e => {
  const b = e.target.closest('.phrase'); if (!b) return;
  const p = shown[+b.dataset.i];
  openShow({ big: heOf(p), bigLang: 'he', sub: p.en, hint: `${pick(p.ru)}<br><b>${trOf(p)}</b>`, sayText: heOf(p), sayLang: 'he' });
});

/* ---------- деньги ---------- */
let dir = 'ils';
const fmt = n => n.toLocaleString('ru-RU', { maximumFractionDigits: n < 10 ? 2 : 0 });
const getRate = () => { const v = parseFloat(String($('rate').value).replace(',', '.')); return v > 0 ? v : null; };
function renderMoney() {
  const rate = getRate();
  $('rate-note').innerHTML = rate ? (rate === DEFAULT_RATE ? RATE_NOTE : 'Ваш курс сохранён в телефоне.') : '<span class="warn">Впишите курс, чтобы считать.</span>';
  $('amount').placeholder = dir === 'ils' ? 'Сумма в ₪' : 'Сумма в ₽';
  const a = parseFloat(String($('amount').value).replace(',', '.'));
  if (!rate || !(a >= 0) || $('amount').value === '') $('result').innerHTML = '—';
  else if (dir === 'ils') $('result').innerHTML = `${fmt(a * rate)} ₽<small>${fmt(a)} ₪</small>`;
  else $('result').innerHTML = `${fmt(a / rate)} ₪<small>${fmt(a)} ₽</small>`;
  const quick = dir === 'ils' ? [5, 10, 20, 50, 100, 200, 500, 1000] : [100, 500, 1000, 2000, 5000, 10000, 20000, 50000];
  $('chips').innerHTML = quick.map(q => `<button data-q="${q}">${fmt(q)} ${dir === 'ils' ? '₪' : '₽'}</button>`).join('');
  $('cheat').innerHTML = [5, 10, 20, 50, 100, 200, 500].map(r => `<tr><td>${r} ₪</td><td>${rate ? fmt(r * rate) + ' ₽' : '—'}</td></tr>`).join('');
}
$('rate').value = store.get('rate') || DEFAULT_RATE;
$('rate').addEventListener('input', () => { if (getRate()) store.set('rate', String(getRate())); renderMoney(); });
$('amount').addEventListener('input', renderMoney);
$('dir').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  dir = b.dataset.d;
  document.querySelectorAll('#dir button').forEach(x => x.classList.toggle('on', x === b));
  $('amount').value = ''; renderMoney();
});
$('chips').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; $('amount').value = b.dataset.q; renderMoney(); });

/* ---------- вкладки ---------- */
const TITLES = { talk: 'Переводчик', phrases: 'Разговорник', money: 'Шекели ↔ рубли', help: 'Справка' };
let currentTab = 'talk';
$('nav').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  currentTab = b.dataset.t;
  document.querySelectorAll('#nav button').forEach(x => x.classList.toggle('on', x === b));
  document.querySelectorAll('.tab').forEach(x => x.classList.toggle('on', x.id === 'tab-' + currentTab));
  $('title').textContent = TITLES[currentTab];
  $('hdr-talk').hidden = currentTab !== 'talk';
  $('gender').hidden = currentTab !== 'phrases';
  $('dock').classList.toggle('on', currentTab === 'talk' && basicReady());
  if (currentTab === 'help') renderReady();
  window.scrollTo({ top: 0 });
});

renderOther(); setMics(); renderGender(); renderCats(); renderList(); renderMoney();
checkReady();
