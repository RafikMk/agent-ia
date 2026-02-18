/**
 * Configuration centralisée - charge depuis .env
 * Toutes les variables sont documentées dans .env.example
 */
require('dotenv').config();

const required = ['OPENAI_API_KEY'];

function getEnv(key, defaultValue = undefined) {
  const value = process.env[key] ?? defaultValue;
  if (required.includes(key) && (value === undefined || value === '')) {
    throw new Error(`Variable d'environnement requise manquante: ${key}. Voir .env.example`);
  }
  return value;
}

module.exports = {
  ws: {
    host: getEnv('WS_HOST', '0.0.0.0'),
    port: parseInt(getEnv('WS_PORT', '8080'), 10),
  },
  google: {
    credentialsPath: getEnv('GOOGLE_APPLICATION_CREDENTIALS', ''),
    projectId: getEnv('GOOGLE_CLOUD_PROJECT', ''),
    stt: {
      recognizer: getEnv('GOOGLE_STT_RECOGNIZER', ''),
    },
    tts: {
      voice: getEnv('GOOGLE_TTS_VOICE', 'fr-FR-Wavenet-A'),
      languageCode: getEnv('GOOGLE_TTS_LANGUAGE', 'fr-FR'),
    },
  },
  openai: {
    apiKey: getEnv('OPENAI_API_KEY'),
    model: getEnv('OPENAI_MODEL', 'gpt-4o-mini'),
    systemPrompt: getEnv('OPENAI_SYSTEM_PROMPT', 'Tu es un assistant vocal professionnel. Réponds de manière concise et naturelle.'),
  },
  /** Format audio attendu par mod_audio_stream / téléphonie (8 kHz, 16-bit mono) */
  audio: {
    sampleRateHz: 8000,
    encoding: 'LINEAR16',
    channelCount: 1,
  },
};
