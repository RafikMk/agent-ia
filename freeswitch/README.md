# FreeSWITCH + mod_audio_stream

Ce dossier contient des exemples de configuration pour faire pointer les appels vers le serveur Node.js (WebSocket).

## Fichiers

- `modules.conf.xml` — charger `mod_audio_stream` (si compilé séparément).
- `dialplan/ia_repondeur.xml` — dialplan exemple : envoyer l’appel vers l’agent IA via audio_stream.

## Prérequis

1. FreeSWITCH installé sur le VPS (voir CONFIGURATION.md).
2. mod_audio_stream compilé et installé (voir CONFIGURATION.md).
3. Node.js (ia-repondeur) qui tourne et écoute sur `ws://IP_VPS:8080`.

## URL WebSocket

L’URL utilisée dans le dialplan doit être celle de votre serveur Node.js, par exemple :

- `ws://127.0.0.1:8080` si Node et FreeSWITCH sont sur la même machine.
- `ws://VOTRE_IP_VPS:8080` depuis une autre machine (ex. même serveur, autre conteneur).

Ne pas exposer le port 8080 en public sans sécurisation (firewall, reverse proxy WSS, etc.).
