// Какие модели нужны и сколько они весят (МБ, примерно) — для экрана скачивания.
export const MODELS = {
  // Обычный Whisper base: русский и английский.
  'asr-base': { task: 'automatic-speech-recognition', id: 'onnx-community/whisper-base', dtype: { encoder_model: 'q8', decoder_model_merged: 'q8' }, files: ['onnx/encoder_model_quantized.onnx', 'onnx/decoder_model_merged_quantized.onnx'] },
  // Whisper small, дообученный на иврите (ivrit-ai): на иврите ошибается вдвое реже обычного.
  'asr-he': { task: 'automatic-speech-recognition', id: 'mike249/whisper-small-he-v4', dtype: { encoder_model: 'q8', decoder_model_merged: 'q8' }, files: ['onnx/encoder_model_quantized.onnx', 'onnx/decoder_model_merged_quantized.onnx'] },
  'ru-he': { task: 'translation', id: 'Helsinki-NLP/opus-mt-ru-he', dtype: 'q8', files: ['onnx/encoder_model_quantized.onnx', 'onnx/decoder_model_merged_quantized.onnx'] },
  'he-ru': { task: 'translation', id: 'Helsinki-NLP/opus-mt-he-ru', dtype: 'q8', files: ['onnx/encoder_model_quantized.onnx', 'onnx/decoder_model_merged_quantized.onnx'] },
  'ru-en': { task: 'translation', id: 'Xenova/opus-mt-ru-en', dtype: 'q8', files: ['onnx/encoder_model_quantized.onnx', 'onnx/decoder_model_merged_quantized.onnx'] },
  'en-ru': { task: 'translation', id: 'Xenova/opus-mt-en-ru', dtype: 'q8', files: ['onnx/encoder_model_quantized.onnx', 'onnx/decoder_model_merged_quantized.onnx'] },
};

export const SIZE_MB = { 'asr-base': 78, 'asr-he': 250, 'ru-he': 120, 'he-ru': 120, 'ru-en': 112, 'en-ru': 112 };
// Обязательное: только перевод. Распознаёт речь сам телефон (Google).
export const BASIC = ['ru-he', 'he-ru', 'ru-en', 'en-ru'];
// Запасное распознавание прямо в приложении — если Google без интернета не работает.
export const WHISPER = ['asr-base', 'asr-he'];
