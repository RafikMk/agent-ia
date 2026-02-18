/**
 * Google Cloud Speech-to-Text - Reconnaissance vocale en flux (streaming)
 * Doc: https://cloud.google.com/speech-to-text/docs/streaming-recognize
 */

const speech = require('@google-cloud/speech');
const config = require('../config');

let speechClient = null;

function getClient() {
  if (!speechClient) {
    const options = config.google.credentialsPath
      ? { keyFilename: config.google.credentialsPath }
      : {};
    if (config.google.projectId) options.projectId = config.google.projectId;
    speechClient = new speech.SpeechClient(options);
  }
  return speechClient;
}

/**
 * Crée un stream de reconnaissance en temps réel.
 * @param {Object} callbacks
 * @param {function(string)} callbacks.onTranscript - Transcription partielle ou finale
 * @param {function(boolean)} callbacks.onIsFinal - true si résultat final
 * @param {function(Error)} callbacks.onError
 * @returns {{ write: function(Buffer), end: function() }}
 */
function createStreamingRecognizer(callbacks) {
  const client = getClient();

  const recognitionConfig = {
    encoding: config.audio.encoding,
    sampleRateHertz: config.audio.sampleRateHz,
    languageCode: config.google.tts.languageCode,
    model: 'phone_call',
    singleUtterance: false,
  };
  if (config.google.stt.recognizer) {
    recognitionConfig.recognizer = config.google.stt.recognizer;
  }

  let firstWrite = true;
  const recognizeStream = client
    .streamingRecognize()
    .on('data', (data) => {
      const result = data.results?.[0];
      if (!result) return;
      const transcript = result.alternatives?.[0]?.transcript;
      if (transcript) {
        callbacks.onTranscript(transcript, result.isFinal);
      }
    })
    .on('error', (err) => {
      callbacks.onError(err);
    })
    .on('end', () => {});

  return {
    write(chunk) {
      if (!recognizeStream.writable) return;
      if (firstWrite) {
        firstWrite = false;
        recognizeStream.write({
          streamingConfig: {
            config: recognitionConfig,
            interimResults: true,
          },
        });
      }
      recognizeStream.write({ audioContent: chunk });
    },
    end() {
      if (recognizeStream.writable) recognizeStream.end();
    },
  };
}

module.exports = { createStreamingRecognizer, getClient };
