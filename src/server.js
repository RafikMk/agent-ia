/**
 * Serveur temps réel IA Répondeur
 * WebSocket reçoit l'audio FreeSWITCH (mod_audio_stream) → STT → GPT → TTS → renvoie l'audio
 */

const WebSocket = require('ws');
const config = require('./config');
const CallSession = require('./session');

const wss = new WebSocket.Server({
  host: config.ws.host,
  port: config.ws.port,
});

function log(...args) {
  const ts = new Date().toISOString();
  console.log(`[${ts}]`, ...args);
}

wss.on('listening', () => {
  log(`WebSocket IA Répondeur écoute sur ws://${config.ws.host}:${config.ws.port}`);
});

wss.on('connection', (ws, req) => {
  const remote = req.socket.remoteAddress;
  log('Nouvelle connexion FreeSWITCH', remote);

  const session = new CallSession(ws, log);
  session.start();

  ws.on('message', (data) => {
    if (Buffer.isBuffer(data) || data instanceof ArrayBuffer) {
      const chunk = Buffer.isBuffer(data) ? data : Buffer.from(data);
      session.pushAudio(chunk);
    } else if (typeof data === 'string') {
      try {
        const obj = JSON.parse(data);
        if (obj.audio) {
          session.pushAudio(Buffer.from(obj.audio, 'base64'));
        }
      } catch (_) {
        log('Message texte ignoré:', data.slice(0, 80));
      }
    }
  });

  ws.on('close', () => {
    session.end();
    log('Connexion fermée', remote);
  });

  ws.on('error', (err) => {
    log('WebSocket error', err.message);
    session.end();
  });
});

wss.on('error', (err) => {
  log('Serveur WebSocket error', err.message);
  process.exitCode = 1;
});

process.on('SIGINT', () => {
  log('Arrêt du serveur...');
  wss.close(() => process.exit(0));
});
