# Модели

Сконвертированы в ONNX (int8) для transformers.js.

| Папка | Исходная модель | Лицензия |
|---|---|---|
| `Helsinki-NLP/opus-mt-ru-he` | https://huggingface.co/Helsinki-NLP/opus-mt-ru-he | Apache-2.0 |
| `Helsinki-NLP/opus-mt-he-ru` | https://huggingface.co/Helsinki-NLP/opus-mt-he-ru | Apache-2.0 |
| `mike249/whisper-small-he-v4` | https://huggingface.co/mike249/whisper-small-he-v4 (дообучение openai/whisper-small на ivrit-ai) | Apache-2.0 |

`decoder_model_merged_quantized.onnx` у whisper разрезан на части (лимит GitHub 100 МБ), склеивает `sw.js`.
Остальные модели (`onnx-community/whisper-base`, `Xenova/opus-mt-ru-en`, `Xenova/opus-mt-en-ru`) грузятся с Hugging Face.
