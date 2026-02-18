# IA Répondeur – Agent vocal temps réel pour centre d’appels (3CX + FreeSWITCH)

Agent IA qui répond aux appels en temps réel : **3CX Cloud** → **SIP** → **FreeSWITCH** (VPS) → **WebSocket** → **Node.js** (STT → GPT → TTS) → playback vers l’appelant.

## Architecture

```
Client (téléphone) → 3CX Cloud → SIP Trunk → VPS (FreeSWITCH)
                                                      ↓
                                            mod_audio_stream (WebSocket)
                                                      ↓
                                            Node.js (ce dépôt)
                                                      ↓
                              Google STT → GPT (streaming) → Google TTS
                                                      ↓
                                            FreeSWITCH (playback) → Client
```

## Prérequis

- Node.js 18+
- Compte Google Cloud (Speech-to-Text + Text-to-Speech)
- Clé API OpenAI (GPT)
- FreeSWITCH avec **mod_audio_stream** sur le VPS (Debian 12 x64 recommandé ; voir [CONFIGURATION.md](CONFIGURATION.md))

## Installation locale

```bash
git clone https://github.com/VOTRE_USER/ia-repondeur.git
cd ia-repondeur
cp .env.example .env
# Éditer .env : OPENAI_API_KEY, GOOGLE_APPLICATION_CREDENTIALS, etc.
npm install
npm start
```

Le serveur WebSocket écoute par défaut sur `ws://0.0.0.0:8080`. FreeSWITCH (mod_audio_stream) doit pointer vers cette URL. Le dialplan fourni route le numéro de test **8000** vers l’agent IA.

## Variables d’environnement

Voir [.env.example](.env.example). Principales :

- `OPENAI_API_KEY` – obligatoire
- `GOOGLE_APPLICATION_CREDENTIALS` – chemin vers le JSON du compte de service Google
- `GOOGLE_TTS_VOICE` / `GOOGLE_TTS_LANGUAGE` – langue et voix (ex. `fr-FR-Wavenet-A`, `fr-FR`)
- `WS_PORT` – port WebSocket (défaut 8080)

## Configuration complète (VPS, 3CX, FreeSWITCH, Google, GitHub)

Toutes les étapes **from scratch** (VPS Debian 12, FreeSWITCH, mod_audio_stream, 3CX SIP trunk, Google Cloud, OpenAI, GitHub + déploiement) sont dans **[CONFIGURATION.md](CONFIGURATION.md)**. Numéro de test : **8000**.

## Structure du projet

- `src/server.js` – serveur WebSocket et entrée des appels
- `src/session.js` – une session = un appel (STT → GPT → TTS)
- `src/services/stt.js` – Google Speech-to-Text (streaming)
- `src/services/llm.js` – OpenAI GPT (streaming)
- `src/services/tts.js` – Google Text-to-Speech
- `src/config.js` – configuration depuis `.env`
- `freeswitch/` – exemples de dialplan et chargement de mod_audio_stream

## Licence

MIT
# agent-ia
