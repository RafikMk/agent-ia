# Configuration complète – IA Répondeur (3CX → FreeSWITCH → Node.js)

Ce guide décrit les étapes **from scratch** pour déployer l’agent IA vocal sur un VPS Ubuntu, le connecter à 3CX Cloud via SIP, et pousser le code sur GitHub puis le cloner sur le VPS.

---

## 1. Architecture validée

Le flux suivant est **fonctionnel** :

```
Client (téléphone) → 3CX Cloud → SIP Trunk → VPS Ubuntu (FreeSWITCH)
                                                      ↓
                                            mod_audio_stream (WebSocket)
                                                      ↓
                                            Node.js (ce dépôt)
                                                      ↓
                              Google STT → GPT (streaming) → Google TTS
                                                      ↓
                                            FreeSWITCH (playback) → Client
```

- **3CX** : PBX cloud qui envoie les appels vers votre VPS via un trunk SIP.
- **FreeSWITCH** : Sur le VPS, reçoit les appels SIP et envoie/reçoit l’audio en temps réel via **mod_audio_stream** (WebSocket).
- **Node.js** : Reçoit l’audio, fait STT (Google), envoie le texte à GPT, fait TTS (Google), renvoie l’audio à FreeSWITCH pour playback.

---

## 2. Prérequis généraux

- Un **VPS Ubuntu** (20.04 ou 22.04 LTS recommandé) avec IP publique.
- Un compte **3CX Cloud** (ou 3CX on‑prem) pour le centre d’appels.
- Un projet **Google Cloud** avec facturation activée (STT + TTS).
- Une clé API **OpenAI** (GPT).
- Un dépôt **GitHub** pour le code.

---

## 3. VPS Ubuntu – préparation

Référence : [Ubuntu Server Guide](https://ubuntu.com/server/docs).

```bash
# Mise à jour
sudo apt update && sudo apt upgrade -y

# Outils utiles
sudo apt install -y git curl build-essential
```

- Ouvrir en firewall les ports **5060/UDP** (SIP), **5080/TCP** (SIP TLS si utilisé), **8021** (Event Socket si besoin), et **8080** (WebSocket Node.js, à restreindre si possible à localhost ou à un reverse proxy).

Exemple (ufw) :

```bash
sudo ufw allow 5060/udp
sudo ufw allow 5080/tcp
sudo ufw allow 8080/tcp   # ou seulement depuis localhost selon votre topologie
sudo ufw enable
```

---

## 4. Installation de FreeSWITCH sur le VPS

Documentation officielle : [FreeSWITCH Wiki – Installation](https://freeswitch.org/confluence/display/FREESWITCH/Installation).

### 4.1 Dépendances (Ubuntu 22.04)

```bash
sudo apt install -y build-essential pkg-config uuid-dev zlib1g-dev libjpeg-dev \
  libsqlite3-dev libcurl4-openssl-dev libpcre3-dev libspeexdsp-dev libldns-dev \
  libedit-dev libtiff5-dev yasm libopus-dev libsndfile1-dev unzip libavformat-dev \
  libswscale-dev libavresample-dev liblua5.2-dev liblua5.2 cmake libpq-dev \
  unixodbc-dev autoconf automake libxml2-dev libpq-dev libpq5 ntpdate
```

### 4.2 Libs SignalWire (pour FreeSWITCH 1.10+)

```bash
sudo git clone https://github.com/signalwire/libks.git /usr/local/src/libks
cd /usr/local/src/libks && sudo cmake . && sudo make && sudo make install

sudo git clone https://github.com/signalwire/signalwire-c.git /usr/local/src/signalwire-c
cd /usr/local/src/signalwire-c && sudo cmake . && sudo make && sudo make install
```

### 4.3 Compilation FreeSWITCH

```bash
cd /usr/src
sudo git clone https://github.com/signalwire/freeswitch.git -b v1.10 freeswitch
cd freeswitch
sudo git config pull.rebase true
sudo ./bootstrap.sh -j
sudo ./configure
sudo make -j$(nproc)
sudo make install
```

### 4.4 Utilisateur et permissions

```bash
sudo groupadd freeswitch
sudo adduser --quiet --system --home /usr/local/freeswitch --gecos "FreeSWITCH" \
  --ingroup freeswitch freeswitch --disabled-password
sudo chown -R freeswitch:freeswitch /usr/local/freeswitch
sudo chmod -R ug=rwX,o= /usr/local/freeswitch
```

### 4.5 Fichiers de configuration par défaut

```bash
sudo make samples
# ou copier les configs depuis /usr/src/freeswitch/conf vers /usr/local/freeswitch/conf
```

Démarrer une fois pour vérifier :

```bash
sudo /usr/local/freeswitch/bin/freeswitch -nc
```

---

## 5. mod_audio_stream (WebSocket)

Documentation / code : [amigniter/mod_audio_stream](https://github.com/amigniter/mod_audio_stream).

Ce module envoie l’audio du canal FreeSWITCH vers une URL WebSocket (notre serveur Node.js) et peut recevoir l’audio en retour pour le playback.

### 5.1 Dépendances

```bash
sudo apt install -y libfreeswitch-dev libssl-dev zlib1g-dev libevent-dev libspeexdsp-dev cmake
```

### 5.2 Compilation et installation

```bash
cd /usr/local/src
sudo git clone --recursive https://github.com/amigniter/mod_audio_stream.git
cd mod_audio_stream
sudo mkdir build && cd build
sudo cmake -DCMAKE_BUILD_TYPE=Release ..
sudo make
sudo make install
```

Le `.so` est en général installé dans un répertoire que FreeSWITCH charge (ex. `/usr/local/freeswitch/mod/` selon votre install). Vérifier le README du module pour le chemin exact et l’ajouter à `modules.conf.xml` :

```xml
<load module="mod_audio_stream"/>
```

Redémarrer FreeSWITCH. Dans le dialplan, utiliser une application du type `audio_stream` avec l’URL de votre serveur Node (ex. `ws://127.0.0.1:8080 bidirectional`). Voir le fichier `freeswitch/dialplan/ia_repondeur.xml` fourni dans ce dépôt.

---

## 6. Configuration 3CX – SIP Trunk vers le VPS

Documentation 3CX :

- [Configuring a SIP Trunk](https://www.3cx.com/docs/manual/sip-trunks/)
- [Configuring a VoIP Gateway](https://www.3cx.com/docs/manual/configuring-voip-gateway/)
- [Outbound Call Routing](https://www.3cx.com/docs/manual/outbound-call-routing/)

### 6.1 Côté FreeSWITCH (VPS) – accepter le trunk 3CX

Sur le VPS, configurer FreeSWITCH pour accepter les appels SIP depuis l’IP (ou le domaine) 3CX :

- **SIP profile** : dans `conf/sip_profiles/` (ex. `external.xml`), autoriser l’IP 3CX ou utiliser authentification (username/password).
- **Dialplan** : une règle qui envoie les appels entrants (DID ou numéro cible) vers l’extension/application qui lance `audio_stream` vers Node.js (voir `freeswitch/dialplan/ia_repondeur.xml`).

Exemple minimal pour un trunk “3CX” : créer un gateway SIP 3CX qui envoie les appels vers l’IP du VPS, et sur le VPS une règle du type “si destination = numéro de l’agent IA → answer → audio_stream → hangup”.

### 6.2 Côté 3CX Cloud – Trunk sortant vers le VPS

1. Dans **3CX Management Console** : **SIP Trunks** → **Add SIP Trunk**.
2. Choisir **Generic** (ou le fournisseur qui correspond à “trunk personnalisé”).
3. Renseigner :
   - **Host** : IP publique du VPS (ou FQDN).
   - **Port** : 5060 (ou 5080 si TLS).
   - **Username / Password** : si FreeSWITCH exige une authentification (à créer côté FreeSWITCH).
4. **Outbound Call Routing** : créer une règle pour que les appels destinés au numéro de l’agent IA (ou à une extension dédiée) passent par ce trunk vers le VPS.

Ainsi, quand un client appelle le numéro géré par 3CX, 3CX envoie l’appel au VPS (FreeSWITCH), qui lance mod_audio_stream vers Node.js.

---

## 7. Google Cloud – STT et TTS

Documentation :

- [Speech-to-Text – Streaming](https://cloud.google.com/speech-to-text/docs/streaming-recognize)
- [Text-to-Speech – Node.js](https://cloud.google.com/text-to-speech/docs/create-audio)

### 7.1 Projet et API

1. [Google Cloud Console](https://console.cloud.google.com/) → créer ou sélectionner un projet.
2. Activer **Speech-to-Text API** et **Cloud Text-to-Speech API**.
3. **Facturation** : lier un compte de facturation au projet.

### 7.2 Compte de service et clé JSON

1. **IAM & Admin** → **Service Accounts** → **Create Service Account** (ex. `ia-repondeur`).
2. Rôles : au minimum **Cloud Speech-to-Text User** et **Cloud Text-to-Speech User**.
3. **Keys** → **Add Key** → **JSON** → télécharger le fichier.
4. Sur le VPS (ou en local), placer ce fichier dans le projet, ex. `config/google-credentials.json`, et définir dans `.env` :

   ```bash
   GOOGLE_APPLICATION_CREDENTIALS=./config/google-credentials.json
   GOOGLE_CLOUD_PROJECT=votre-project-id
   ```

### 7.3 Langue et voix

Dans `.env` (ou dans `src/config.js`) :

- `GOOGLE_TTS_VOICE=fr-FR-Wavenet-A` (ou une autre voix FR).
- `GOOGLE_TTS_LANGUAGE=fr-FR`.

Le STT utilise la même langue (config dans le code : `languageCode`).

---

## 8. OpenAI (GPT)

Documentation : [OpenAI API – Chat Completions](https://platform.openai.com/docs/api-reference/chat/create).

1. Créer une clé API : [API Keys](https://platform.openai.com/api-keys).
2. Dans `.env` :

   ```bash
   OPENAI_API_KEY=sk-...
   OPENAI_MODEL=gpt-4o-mini
   OPENAI_SYSTEM_PROMPT=Tu es un assistant vocal professionnel du centre d'appels AdaAppel...
   ```

---

## 9. Dépôt GitHub et déploiement sur le VPS

### 9.1 Créer le dépôt et pousser le code (en local)

```bash
cd /chemin/vers/ia-repondeur
git init
git add .
git commit -m "Initial: serveur IA répondeur 3CX/FreeSWITCH/Node"
git branch -M main
git remote add origin https://github.com/VOTRE_USER/ia-repondeur.git
git push -u origin main
```

(Remplacez `VOTRE_USER` par votre compte GitHub. Utilisez un token ou SSH si besoin.)

### 9.2 Cloner sur le VPS

```bash
ssh utilisateur@IP_VPS
cd /opt   # ou un répertoire de votre choix
sudo git clone https://github.com/VOTRE_USER/ia-repondeur.git
cd ia-repondeur
```

### 9.3 Configuration sur le VPS

```bash
cp .env.example .env
nano .env   # remplir GOOGLE_APPLICATION_CREDENTIALS, OPENAI_API_KEY, etc.
mkdir -p config
# Copier le fichier JSON du compte de service Google dans config/google-credentials.json
```

### 9.4 Node.js et dépendances

Installer Node.js 18+ (ou 20 LTS) :

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

Puis :

```bash
cd /opt/ia-repondeur
npm install
npm start
```

Pour un service système (optionnel) :

```bash
sudo nano /etc/systemd/system/ia-repondeur.service
```

Contenu type :

```ini
[Unit]
Description=IA Répondeur WebSocket Server
After=network.target

[Service]
Type=simple
User=utilisateur
WorkingDirectory=/opt/ia-repondeur
ExecStart=/usr/bin/node src/server.js
Restart=on-failure
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

Puis :

```bash
sudo systemctl daemon-reload
sudo systemctl enable ia-repondeur
sudo systemctl start ia-repondeur
sudo systemctl status ia-repondeur
```

---

## 10. Résumé des étapes

| # | Étape | Référence |
|---|--------|-----------|
| 1 | VPS Ubuntu + firewall (SIP, WebSocket) | § 3 |
| 2 | Installer FreeSWITCH (source) | § 4 |
| 3 | Compiler et charger mod_audio_stream | § 5 |
| 4 | Configurer 3CX : trunk SIP vers VPS + routage sortant | § 6 |
| 5 | Google Cloud : STT/TTS, compte de service, JSON | § 7 |
| 6 | OpenAI : clé API + .env | § 8 |
| 7 | GitHub : push du code, clone sur VPS, .env, npm start (ou systemd) | § 9 |

Une fois tout en place : un appel reçu par 3CX et routé vers le VPS déclenche FreeSWITCH → mod_audio_stream → Node.js → STT → GPT → TTS → playback vers le client. L’architecture décrite est **fonctionnelle** ; il reste à ajuster dialplan et 3CX selon vos numéros et règles métier.
