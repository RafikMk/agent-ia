/**
 * Une session = un appel (une connexion WebSocket FreeSWITCH).
 * Pipeline: Audio reçu → STT → transcript → GPT → TTS → Audio envoyé.
 */

const stt = require('./services/stt');
const llm = require('./services/llm');
const tts = require('./services/tts');

class CallSession {
  constructor(ws, log) {
    this.ws = ws;
    this.log = log || (() => {});
    this.messages = [];
    this.sttStream = null;
    this.isProcessing = false;
    this.buffer = Buffer.alloc(0);
  }

  start() {
    this.log('Session démarrée');
    this.sttStream = stt.createStreamingRecognizer({
      onTranscript: (transcript, isFinal) => this.onTranscript(transcript, isFinal),
      onError: (err) => this.log('STT error', err.message),
    });
  }

  onTranscript(transcript, isFinal) {
    if (!transcript.trim()) return;
    this.log(isFinal ? 'Transcript (final)' : 'Transcript (interim)', transcript);
    if (!isFinal) return;

    this.messages.push({ role: 'user', content: transcript });
    if (this.isProcessing) {
      this.pendingUserText = transcript;
      return;
    }
    this.processWithLLM(transcript);
  }

  async processWithLLM(userText) {
    this.isProcessing = true;
    this.pendingUserText = null;

    try {
      await llm.streamChatCompletion(this.messages, {
        onChunk: () => {},
        onDone: async (fullResponse) => {
          this.messages.push({ role: 'assistant', content: fullResponse });
          this.log('GPT réponse', fullResponse.slice(0, 80) + '...');
          await this.speakAndSend(fullResponse);
        },
        onError: (err) => {
          this.log('LLM error', err.message);
          this.speakAndSend("Désolé, une erreur s'est produite. Réessayez.");
        },
      });
    } finally {
      this.isProcessing = false;
      if (this.pendingUserText) {
        const next = this.pendingUserText;
        this.pendingUserText = null;
        this.messages.push({ role: 'user', content: next });
        this.processWithLLM(next);
      }
    }
  }

  async speakAndSend(text) {
    if (!text || !this.ws || this.ws.readyState !== 1) return;
    tts.synthesize(text, (err, pcmBuffer) => {
      if (err) {
        this.log('TTS error', err.message);
        return;
      }
      if (this.ws.readyState === 1) {
        this.ws.send(pcmBuffer, { binary: true });
        this.log('TTS envoyé', pcmBuffer.length, 'bytes');
      }
    });
  }

  pushAudio(chunk) {
    if (this.sttStream && chunk && chunk.length) {
      this.sttStream.write(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
  }

  end() {
    if (this.sttStream) this.sttStream.end();
    this.sttStream = null;
    this.log('Session terminée');
  }
}

module.exports = CallSession;
