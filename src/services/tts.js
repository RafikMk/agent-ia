/**
 * Google Cloud Text-to-Speech - Synthèse vocale pour playback FreeSWITCH
 * Doc: https://cloud.google.com/text-to-speech/docs
 * Sortie: PCM 16-bit à 8 kHz (ou 24 kHz selon config) pour envoi au WebSocket FreeSWITCH
 */

const textToSpeech = require('@google-cloud/text-to-speech');
const config = require('../config');

let ttsClient = null;

function getClient() {
  if (!ttsClient) {
    const options = config.google.credentialsPath
      ? { keyFilename: config.google.credentialsPath }
      : {};
    if (config.google.projectId) options.projectId = config.google.projectId;
    ttsClient = new textToSpeech.TextToSpeechClient(options);
  }
  return ttsClient;
}

/**
 * Synthétise le texte en audio PCM 16-bit 8 kHz (format téléphonie).
 * @param {string} text - Texte à synthétiser
 * @param {function(Error, Buffer)} callback - (err, pcmBuffer)
 */
function synthesize(text, callback) {
  const client = getClient();
  const request = {
    input: { text },
    voice: {
      languageCode: config.google.tts.languageCode,
      name: config.google.tts.voice,
    },
    audioConfig: {
      audioEncoding: 'LINEAR16',
      sampleRateHertz: config.audio.sampleRateHz,
      speakingRate: 1.0,
      pitch: 0,
    },
  };

  client
    .synthesizeSpeech(request)
    .then(([response]) => {
      const audio = response.audioContent;
      if (audio && audio.length) {
        callback(null, Buffer.from(audio));
      } else {
        callback(new Error('Réponse TTS vide'));
      }
    })
    .catch((err) => callback(err));
}

/**
 * Version Promise pour usage async.
 */
function synthesizeAsync(text) {
  return new Promise((resolve, reject) => {
    synthesize(text, (err, buffer) => (err ? reject(err) : resolve(buffer)));
  });
}

module.exports = { synthesize, synthesizeAsync, getClient };
