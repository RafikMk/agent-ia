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

FreeSWITCH est installé : **config dans `/etc/freeswitch/`**, binaires dans le `PATH`. Démarrer et tester :

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

Indiquer le répertoire d’installation de FreeSWITCH pour que le `.so` soit installé au bon endroit (adapter `FREESWITCH_DIR` selon votre install) :

- **FreeSWITCH installé par paquets (Option A)** : souvent `/usr` ou `/usr/share/freeswitch` → vérifier avec `fs_cli -x "module_exists mod_console"` et le chemin des modules (variable `mod_dir` ou répertoire dans `/usr`).
- **FreeSWITCH compilé avec `--prefix=/usr/local/freeswitch`** : utiliser `FREESWITCH_DIR=/usr/local/freeswitch`.

```bash
cd /usr/local/src
sudo git clone --recursive https://github.com/amigniter/mod_audio_stream.git
cd mod_audio_stream
sudo mkdir build && cd build
# Adapter FREESWITCH_DIR selon votre installation (voir ci‑dessus)
sudo cmake -DCMAKE_BUILD_TYPE=Release -DFREESWITCH_DIR=/usr/local/freeswitch ..
sudo make
sudo make install
```

### 5.3 Où est le `.so` et chargement du module

Le `.so` est en général installé dans le répertoire **mod** que FreeSWITCH utilise pour charger les modules, par exemple :

| Type d’install FreeSWITCH | Répertoire de config (conf_dir) | Répertoire des modules (mod) |
|---------------------------|----------------------------------|------------------------------|
| **Paquets (fsget)**       | **`/etc/freeswitch/`**           | Souvent `/usr/lib/freeswitch/mod/` ou sous `/usr/lib/` |
| Compilé avec `--prefix=/usr/local/freeswitch` | `/usr/local/freeswitch/conf/` | `/usr/local/freeswitch/mod/` |

Vérifier le README du module pour le chemin exact après `make install`. Si le `.so` est ailleurs, le copier dans le répertoire mod utilisé par FreeSWITCH.

**Activer le module** : éditer le fichier **`autoload_configs/modules.conf.xml`** dans le répertoire de config FreeSWITCH :
- **Paquets** → `/etc/freeswitch/autoload_configs/modules.conf.xml`
- **Source (prefix)** → `/usr/local/freeswitch/conf/autoload_configs/modules.conf.xml`

Dans la section `<modules>`, ajouter :

```xml
<load module="mod_audio_stream"/>
```

Redémarrer FreeSWITCH après modification.

### 5.4 Dialplan et URL WebSocket

Dans le dialplan, utiliser l’application **`audio_stream`** avec l’URL de votre serveur Node.js, par exemple en **bidirectionnel** :

```xml
<action application="audio_stream" data="ws://127.0.0.1:8080 bidirectional"/>
```

Exemple complet : fichier **`freeswitch/dialplan/ia_repondeur.xml`** dans ce dépôt (numéro de test **8000**).

**Si FreeSWITCH est installé par paquets** : la config est dans **`/etc/freeswitch/`**. Pour le dialplan 8000, copier le fichier du dépôt vers `/etc/freeswitch/dialplan/default/ia_repondeur.xml` puis l’inclure depuis `default.xml` (ex. `<X-PRE-PROCESS cmd="include" data="default/ia_repondeur.xml"/>` dans la section des includes du contexte default).

---

## 6. Configuration 3CX – SIP Trunk vers le VPS

Documentation 3CX :

- [Configuring a SIP Trunk](https://www.3cx.com/docs/manual/sip-trunks/)
- [Configuring a VoIP Gateway](https://www.3cx.com/docs/manual/configuring-voip-gateway/)
- [Outbound Call Routing](https://www.3cx.com/docs/manual/outbound-call-routing/)

### 6.1 Côté FreeSWITCH (VPS) – accepter le trunk 3CX

Objectif : que FreeSWITCH **accepte les appels SIP** envoyés par 3CX vers le VPS et les **route vers le 8000** (agent IA). Deux parties : **profil SIP** (qui peut appeler) et **dialplan** (vers quelle application envoyer l’appel).

---

#### Comprendre le flux

1. Un client appelle un numéro géré par **3CX**.
2. **3CX** décide d’envoyer cet appel vers votre **VPS** (trunk sortant) avec la **destination 8000**.
3. **FreeSWITCH** sur le VPS reçoit l’INVITE SIP (depuis l’IP 3CX, destination 8000).
4. FreeSWITCH doit : (a) **accepter** cette connexion SIP, (b) **router** l’appel selon le numéro (8000) → votre règle dialplan lance `audio_stream` vers Node.js.

---

#### Étape 1 – Repérer le profil SIP qui reçoit les appels “externes”

Les appels venant d’internet (dont 3CX) arrivent sur un **profil SIP** dédié (souvent “external” ou “public”).  
**Chemin (install par paquets)** : `/etc/freeswitch/sip_profiles/`.

```bash
ls /etc/freeswitch/sip_profiles/
```

Vous verrez par exemple `external.xml`, `internal.xml`, etc. Le fichier qui **écoute sur le port 5060** (ou 5080) et est prévu pour les trunks/fournisseurs est en général **`external.xml`** (ou un profil nommé dans `freeswitch.xml`). Ouvrez ce fichier pour les étapes suivantes :

```bash
sudo nano /etc/freeswitch/sip_profiles/external.xml
```

---

#### Étape 2 – Autoriser 3CX à envoyer des appels (deux possibilités)

FreeSWITCH doit accepter les INVITE **depuis 3CX**. Deux façons courantes :

**Option A – Autoriser par IP (ACL)**  
Si vous connaissez l’**IP publique** de 3CX (ou de votre instance 3CX Cloud) :

- Dans le **même répertoire** que `external.xml`, il peut y avoir un fichier du type `external.xml` qui contient une section `<param name="acl" value="..."/>` ou des listes ACL.
- Ou dans `/etc/freeswitch/autoload_configs/` un fichier comme `acl.conf.xml` où sont définis des “domaines” (liste d’IP autorisées). Vous créez une liste contenant l’IP 3CX, puis dans le profil external vous référencez cette ACL.

Exemple minimal dans **`acl.conf.xml`** (souvent dans `autoload_configs`) : définir une liste `3cx` avec l’IP de 3CX, puis dans le profil SIP utiliser cette ACL.  
Exemple dans le **profil** (selon votre version) :

```xml
<param name="apply-inbound-acl" value="3cx"/>
```

Et dans `autoload_configs/acl.conf.xml`, une section du type :

```xml
<list name="3cx" default="deny">
  <node type="allow" cidr="IP_3CX/32"/>
</list>
```

Remplacez `IP_3CX` par l’IP publique de 3CX (ex. celle de votre 3CX Cloud).

**Option B – Authentification par username / password**  
3CX envoie un **username** et un **password** (configurés dans 3CX pour ce trunk). Côté FreeSWITCH il faut un **utilisateur SIP** (ou gateway) avec ce même login/mot de passe. Les appels venant de 3CX seront alors authentifiés.

- Créer un utilisateur (dans `directory/` ou dans la config du profil) avec le même **username** et **password** que ceux configurés dans 3CX pour ce trunk.
- Le profil external doit être configuré pour exiger l’auth (souvent le cas par défaut pour les trunks).

Après modification, recharger le profil SIP ou redémarrer FreeSWITCH :

```bash
fs_cli -x "reloadacl"
fs_cli -x "sofia profile external restart"
```

---

#### Étape 3 – Contexte des appels entrants (default vs public)

Quand 3CX envoie un appel vers le VPS, FreeSWITCH le reçoit sur le profil “external” et le fait entrer dans un **contexte** (dialplan). Ce contexte est défini dans le **profil SIP** (ex. dans `external.xml`) par une ligne du type :

```xml
<param name="context" value="default"/>
```

ou `value="public"`. **Notez ce contexte** (souvent `default` pour les trunks).

- Si c’est **`default`** : la règle dialplan **8000** que vous avez mise dans `default/ia_repondeur.xml` s’applique : les appels avec **destination_number = 8000** iront vers `audio_stream`.
- Si c’est **`public`** : il faut soit ajouter la **même** extension (8000 → answer → audio_stream) dans le dialplan **public**, soit faire en sorte que le profil envoie les appels dans le contexte **default** (en mettant `context` à `default`).

Vérification possible après un appel test : dans `fs_cli`, logs ou `show channels` pour voir le contexte de l’appel entrant.

---

#### Étape 4 – Dialplan 8000 (déjà en place)

Vous avez déjà :

- Fichier **`/etc/freeswitch/dialplan/default/ia_repondeur.xml`** avec une extension qui matche **`destination_number = 8000`** et exécute `answer` → `audio_stream ws://127.0.0.1:8080 bidirectional` → `hangup`.
- Inclusion de ce fichier dans **`default.xml`** via `<X-PRE-PROCESS cmd="include" data="default/ia_repondeur.xml"/>`.

Donc : **tout appel entrant dans le contexte `default` avec le numéro 8000** est déjà routé vers l’agent IA. Il reste à s’assurer que les appels venant de 3CX arrivent bien dans le contexte `default` (étape 3) et que 3CX envoie la **destination 8000** (voir § 6.2).

---

#### Résumé schématique

| Où | Quoi |
|----|------|
| **3CX** | Envoie l’appel vers l’IP du VPS, destination **8000**, avec auth ou depuis une IP autorisée. |
| **FreeSWITCH – profil SIP (external)** | Accepte l’appel (ACL ou auth), contexte = **default**. |
| **FreeSWITCH – dialplan default** | Si `destination_number` = **8000** → answer → audio_stream → Node.js → hangup. |

Ensuite : configurer **3CX** (trunk sortant vers le VPS, routage vers 8000) comme décrit au § 6.2.

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
