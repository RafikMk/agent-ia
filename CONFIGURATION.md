# Configuration complète – IA Répondeur (3CX → FreeSWITCH → Node.js)

Ce guide décrit les étapes **from scratch** pour déployer l’agent IA vocal sur un VPS **Debian 12 (Bookworm) x64**, le connecter à 3CX Cloud via SIP, et pousser le code sur GitHub puis le cloner sur le VPS.

---

## 1. Architecture validée

Le flux suivant est **fonctionnel** :

```
Client (téléphone) → 3CX Cloud → SIP Trunk → VPS Debian 12 (FreeSWITCH)
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

- Un **VPS Debian 12 (Bookworm) x64** avec IP publique.
- Un compte **3CX Cloud** (ou 3CX on‑prem) pour le centre d’appels.
- Un projet **Google Cloud** avec facturation activée (STT + TTS).
- Une clé API **OpenAI** (GPT).
- Un dépôt **GitHub** pour le code.

---

## 3. VPS Debian 12 (Bookworm) x64 – préparation

Référence : [Debian Administrator's Handbook](https://debian-handbook.info/).

```bash
# Mise à jour
sudo apt update && sudo apt upgrade -y

# Outils utiles
sudo apt install -y git curl build-essential
```

- Ouvrir en firewall les ports **5060/UDP** (SIP), **5080/TCP** (SIP TLS si utilisé), **8021** (Event Socket si besoin), et **8080** (WebSocket Node.js, à restreindre si possible à localhost ou à un reverse proxy).

Exemple avec **ufw** (à installer sur Debian si besoin) :

```bash
sudo apt install -y ufw
sudo ufw allow 5060/udp
sudo ufw allow 5080/tcp
sudo ufw allow 8080/tcp   # ou seulement depuis localhost selon votre topologie
sudo ufw enable
```

---

## 4. Installation de FreeSWITCH sur le VPS

**Documentation officielle :** [FreeSWITCH on Debian (SignalWire)](https://developer.signalwire.com/freeswitch/FreeSWITCH-Explained/Installation/Linux/Debian_67240088).

Depuis la v1.10.4, **Sofia-SIP** et **SpanDSP** ne sont plus dans l’arbre FreeSWITCH ; les paquets sont fournis par le dépôt SignalWire. Il faut un **SignalWire Personal Access Token** pour utiliser le script officiel (ajout du dépôt). Création du token : [How To Create a SignalWire Personal Access Token](https://developer.signalwire.com/freeswitch/How-To-Create-a-SignalWire-Personal-Access-Token_67240332).

---

### 4.1 Option A : Installation par paquets (recommandé)

Pas de compilation, dépendances (dont SpanDSP/Sofia-SIP) gérées par le dépôt.

```bash
TOKEN=VOTRE_SIGNALWIRE_TOKEN

sudo apt update && sudo apt install -y curl
curl -sSL https://freeswitch.org/fsget | bash -s $TOKEN release install
```

FreeSWITCH est installé (généralement sous `/usr` ou `/etc/freeswitch`). Démarrer et tester :

```bash
fs_cli -rRS
```

(ou `systemctl start freeswitch` selon la configuration du paquet.) Les binaires sont dans le `PATH` ; la config est en général dans `/etc/freeswitch`. Pour **mod_audio_stream**, il faudra le compiler séparément (§ 5) et pointer le dialplan vers le bon chemin.

---

### 4.2 Option B : Compilation depuis les sources (doc officielle)

Référence : [Building From Source – Compiling Release Branch](https://developer.signalwire.com/freeswitch/FreeSWITCH-Explained/Installation/Linux/Debian_67240088#building-from-source).

**Étape 1 –** Ajouter le dépôt SignalWire (fournit les paquets SpanDSP/Sofia-SIP pour la compilation) :

```bash
TOKEN=VOTRE_SIGNALWIRE_TOKEN

sudo apt update && sudo apt install -y curl
curl -sSL https://freeswitch.org/fsget | bash -s $TOKEN
```

**Étape 2 –** Installer les dépendances de build (y compris spandsp/sofia depuis le dépôt) :

```bash
sudo apt-get build-dep freeswitch
```

**Étape 3 –** Cloner, configurer et compiler (sans `--prefix`, installation par défaut dans `/usr/local`) :

```bash
cd /usr/src
sudo git clone -b v1.10 https://github.com/signalwire/freeswitch.git
cd freeswitch
git config pull.rebase true
./bootstrap.sh -j
./configure
make -j$(nproc)
sudo make install
```

**Étape 4 –** Permissions et utilisateur (post-installation officielle) : suivre les instructions affichées après `make install`, ou créer l’utilisateur et appliquer les droits sur le répertoire d’installation (souvent `/usr/local/freeswitch` si défini par le build).

**Étape 5 –** Démarrer :

```bash
# Si le binaire est dans /usr/local/bin (sans prefix) :
/usr/local/bin/freeswitch -nc

# Ou si installé par les paquets :
fs_cli -rRS
```

Pour tout installer sous un répertoire dédié, utiliser par exemple :

```bash
./configure --prefix=/usr/local/freeswitch
```

puis `make` et `sudo make install`. Le binaire sera alors dans `/usr/local/freeswitch/bin/freeswitch`.

---

### 4.3 Option C : Compilation manuelle sans token SignalWire

Si vous ne souhaitez pas utiliser le dépôt SignalWire, il faut compiler **SpanDSP** (et éventuellement **Sofia-SIP**) depuis les sources, puis FreeSWITCH. Voir les dépôts [freeswitch/spandsp](https://github.com/freeswitch/spandsp) et [freeswitch/sofia-sip](https://github.com/freeswitch/sofia-sip). En résumé :

1. Installer les dépendances listées au § 4.1 de l’ancienne version de ce guide (build-essential, libtiff5-dev, etc.).
2. Compiler et installer spandsp (clone → `bootstrap.sh` → `configure --prefix=/usr/local` → `make` → `make install` → `ldconfig`).
3. Exporter `PKG_CONFIG_PATH=/usr/local/lib/pkgconfig` puis compiler FreeSWITCH avec `./configure --prefix=/usr/local/freeswitch` et `make install`.

Cette option est plus longue et sujette aux erreurs de dépendances ; les options A ou B sont recommandées.

**Config vanilla (uniquement si vous avez compilé depuis les sources)** : si le répertoire de config est vide, copier les configs par défaut depuis l’arbre des sources (voir [Vanilla installation files](https://developer.signalwire.com/freeswitch/FreeSWITCH-Explained/Installation/Linux/Vanilla-installation-files_27591294/)), par ex. `cp -r /usr/src/freeswitch/conf/vanilla/* /usr/local/freeswitch/conf/` (adapter le chemin selon votre `--prefix`).

---

## 5. mod_audio_stream (WebSocket)

Documentation / code : [amigniter/mod_audio_stream](https://github.com/amigniter/mod_audio_stream).

Ce module envoie l’audio du canal FreeSWITCH vers une URL WebSocket (notre serveur Node.js) et peut recevoir l’audio en retour pour le playback.

### 5.1 Dépendances (Debian 12)

```bash
sudo apt install -y libssl-dev zlib1g-dev libevent-dev libspeexdsp-dev cmake
```

> **Note :** `libfreeswitch-dev` n’existe pas dans les dépôts Debian ; les en-têtes viennent de l’installation de FreeSWITCH depuis les sources (§ 4). Si le build de mod_audio_stream ne trouve pas FreeSWITCH, indiquer le chemin d’install (ex. `-DFREESWITCH_DIR=/usr/local/freeswitch`) dans la commande cmake.

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
- **Dialplan** : une règle qui envoie les appels entrants (DID ou numéro cible) vers l’extension/application qui lance `audio_stream` vers Node.js (voir `freeswitch/dialplan/ia_repondeur.xml`). **Numéro de test fourni : 8000.**

Exemple minimal pour un trunk “3CX” : créer un gateway SIP 3CX qui envoie les appels vers l’IP du VPS, et sur le VPS une règle du type “si destination = **8000** → answer → audio_stream → hangup”.

### 6.2 Côté 3CX Cloud – Trunk sortant vers le VPS

1. Dans **3CX Management Console** : **SIP Trunks** → **Add SIP Trunk**.
2. Choisir **Generic** (ou le fournisseur qui correspond à “trunk personnalisé”).
3. Renseigner :
   - **Host** : IP publique du VPS (ou FQDN).
   - **Port** : 5060 (ou 5080 si TLS).
   - **Username / Password** : si FreeSWITCH exige une authentification (à créer côté FreeSWITCH).
4. **Outbound Call Routing** : créer une règle pour que les appels destinés au numéro **8000** (numéro de test de l’agent IA) passent par ce trunk vers le VPS.

Ainsi, quand un client appelle le **8000** (ou le numéro 3CX qui redirige vers 8000), 3CX envoie l’appel au VPS (FreeSWITCH), qui lance mod_audio_stream vers Node.js.

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

### 9.4 Node.js et dépendances (Debian 12)

Installer Node.js 20 LTS (NodeSource supporte Debian 12 Bookworm) :

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

Vérifier : `node -v` (v20.x) et `npm -v`.

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
| 1 | VPS Debian 12 x64 + firewall (SIP, WebSocket) | § 3 |
| 2 | Installer FreeSWITCH (source) | § 4 |
| 3 | Compiler et charger mod_audio_stream | § 5 |
| 4 | Configurer 3CX : trunk SIP vers VPS + routage sortant | § 6 |
| 5 | Google Cloud : STT/TTS, compte de service, JSON | § 7 |
| 6 | OpenAI : clé API + .env | § 8 |
| 7 | GitHub : push du code, clone sur VPS, .env, npm start (ou systemd) | § 9 |

Une fois tout en place : un appel reçu par 3CX et routé vers le **8000** déclenche FreeSWITCH → mod_audio_stream → Node.js → STT → GPT → TTS → playback vers le client. L’architecture décrite est **fonctionnelle** ; le numéro de test est **8000** (à adapter dans le dialplan et le routage 3CX si besoin).
