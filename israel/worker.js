// Распознавание речи (Whisper) и перевод (Opus-MT) прямо в телефоне.
// Модели один раз скачиваются и лежат в Cache Storage ('transformers-cache'), дальше всё офлайн.
import { pipeline, env } from './vendor/transformers.min.js';
import { MODELS } from './models.js';

env.allowLocalModels = true;                       // свои модели иврита лежат рядом: ./models/
env.localModelPath = new URL('./models/', self.location).href;
env.allowRemoteModels = true;                      // остальные — с Hugging Face (только при скачивании)
env.backends.onnx.wasm.wasmPaths = new URL('./vendor/', self.location).href;

const LANG = { ru: 'russian', he: 'hebrew', en: 'english' };
const KEEP = 4;                                    // сколько моделей держать в памяти одновременно

const loaded = new Map();                          // key -> Promise<pipeline>, в порядке использования

function get(key, onProgress) {
  if (loaded.has(key)) {
    const p = loaded.get(key); loaded.delete(key); loaded.set(key, p);
    return p;
  }
  const m = MODELS[key];
  const p = pipeline(m.task, m.id, { dtype: m.dtype, device: 'wasm', progress_callback: onProgress });
  p.catch(() => loaded.delete(key));
  loaded.set(key, p);
  while (loaded.size > KEEP) {
    const [old, op] = loaded.entries().next().value;
    loaded.delete(old);
    op.then(x => x.dispose()).catch(() => {});
  }
  return p;
}

// Whisper на тишине и шуме «досочиняет» титры — выкидываем такие фразы.
const JUNK = /(субтитр\S*|продолжение следует|спасибо за просмотр|подписывайтесь|thanks? for watching|please subscribe|תודה שצפיתם|תודה רבה שצפיתם|כתוביות)[^.!?]*[.!?]?/giu;

// Частые ошибки распознавания иврита: на слух כ/ק и т. п. не различить, а переводчик путается.
const HE_FIX = [[/מרכחת/g, 'מרקחת'], [/בחרטיס/g, 'בכרטיס'], [/חרטיס/g, 'כרטיס']];

async function transcribe({ audio, lang }) {
  const asr = await get(lang === 'he' ? 'asr-he' : 'asr-base');
  const out = await asr(audio, { language: LANG[lang], task: 'transcribe', chunk_length_s: 30 });
  let text = String(out.text || '').replace(JUNK, '').replace(/\s+/g, ' ').trim();
  if (lang === 'he') for (const [re, to] of HE_FIX) text = text.replace(re, to);
  return text;
}

const words = s => s.trim().split(/\s+/).filter(Boolean).length;

// Переводим по предложениям: модели иногда теряют вторую половину длинной фразы.
// Если перевод подозрительно короткий — переводим ещё и по частям через запятую.
async function translate({ text, pair }) {
  const mt = await get(pair);
  const one = async s => (await mt(s, { max_new_tokens: 200 }))[0].translation_text.trim();
  const sentences = text.replace(/\s+/g, ' ').trim().split(/(?<=[.!?…])\s+/).filter(Boolean);
  const res = [];
  for (const s of sentences) {
    let t = await one(s);
    const parts = s.split(/,\s+/).filter(Boolean);
    if (parts.length > 1 && words(t) < words(s) * 0.55) {
      const tt = [];
      for (const p of parts) tt.push((await one(p)).replace(/[.!?]$/, ''));
      t = tt.join(', ') + (/[.!?]$/.test(s) ? s.slice(-1) : '');
    }
    res.push(t);
  }
  return res.join(' ');
}

async function download({ keys }) {
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    self.postMessage({ type: 'dl-step', key, index: i, count: keys.length });
    const p = await get(key, e => {
      if (e.status === 'progress' && e.total) self.postMessage({ type: 'dl-progress', key, file: e.file, loaded: e.loaded, total: e.total });
    });
    if (!key.startsWith('asr')) await p('Привет', { max_new_tokens: 4 }).catch(() => {});
  }
}

self.onmessage = async ({ data }) => {
  const { id, type } = data;
  try {
    let result;
    if (type === 'asr') result = await transcribe(data);
    else if (type === 'mt') result = await translate(data);
    else if (type === 'download') result = await download(data);
    else if (type === 'warm') { await get(data.key); result = true; }
    self.postMessage({ id, ok: true, result });
  } catch (e) {
    self.postMessage({ id, ok: false, error: String(e && e.message || e) });
  }
};
