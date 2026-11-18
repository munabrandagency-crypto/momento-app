# Momento Scanner — Guide d'installation

Le système a trois parties :

| Partie | Rôle | À installer |
|---|---|---|
| **Script central** (`apps-script/Code.gs`) | Lit et écrit dans les Google Sheets, garde la liste des mariages | Une seule fois |
| **Application** (site checkin.experiencemomento.com) | Le scanner des hôtesses (`index.html`) et ton espace administrateur (`admin.html`) | Une seule fois |
| **Un Google Sheet par mariage** | La liste des invités | À chaque mariage, depuis l'espace administrateur |

> **Essayer avant de brancher le script :** tant que `config.js` ne contient pas d'URL, l'application tourne en **mode démo** avec 34 invités fictifs. Le mot de passe administrateur est alors `demo`.

---

## 1. Installer le script central (environ 10 minutes, une seule fois)

1. Va sur **script.google.com** avec le compte Google propriétaire des Google Sheets, puis clique sur **Nouveau projet**.
2. Renomme le projet « Momento Scanner » en cliquant sur « Projet sans titre ».
3. Efface tout le contenu de `Code.gs`, puis colle le contenu du fichier `apps-script/Code.gs`.
4. À la ligne `const MOT_DE_PASSE_ADMIN = 'changez-moi';`, remplace `changez-moi` par ton mot de passe administrateur. Enregistre avec l'icône disquette.
5. Dans la liste des fonctions en haut, choisis **autoriser**, puis clique sur **Exécuter**.
   Google demande des autorisations : clique sur *Examiner les autorisations*, choisis ton compte, puis *Paramètres avancés*, *Accéder à Momento Scanner (non sécurisé)* et *Autoriser*.
   C'est normal : c'est ton propre script, pas une application publiée.
6. Clique sur **Déployer → Nouveau déploiement**. Avec l'icône engrenage, choisis le type **Application Web**, puis règle :
   - Exécuter en tant que : **Moi**
   - Qui a accès : **Tout le monde**
7. Clique sur **Déployer**, puis copie l'**URL de l'application Web**. Elle se termine par `/exec`.

> ⚠ Si tu modifies le script plus tard, il faut publier la modification : **Déployer → Gérer les déploiements → ✏️ → Version : Nouvelle version → Déployer**. L'URL ne change pas.

## 2. Brancher l'application en ligne (une seule fois)

L'application est publiée sur GitHub (dépôt `munabrandagency-crypto/momento-app`) et servie à l'adresse **https://checkin.experiencemomento.com**.

**a. Activer GitHub Pages** (une fois)
1. Sur GitHub, ouvre le dépôt **momento-app**, puis **Settings → Pages**.
2. Dans *Build and deployment*, règle *Source* sur **Deploy from a branch**, la branche sur **main** et le dossier sur **/ (root)**, puis clique sur **Save**.
3. Le champ *Custom domain* doit afficher `checkin.experiencemomento.com`, grâce au fichier `CNAME` du dépôt. Si ce n'est pas le cas, saisis-le et enregistre.

**b. Créer le sous-domaine dans Cloudflare** (une fois)
1. Dans Cloudflare, ouvre le domaine **experiencemomento.com**, puis **DNS → Records → Add record**.
2. Remplis la ligne ainsi :
   - Type : `CNAME`
   - Name : `checkin`
   - Target : `munabrandagency-crypto.github.io`
   - Proxy status : **DNS only** (nuage gris)
3. Clique sur **Save**. Le site vitrine et le catalogue ne sont pas touchés : cette ligne ne concerne que `checkin`.
4. Attends 5 à 30 minutes, puis retourne dans GitHub, **Settings → Pages**, et coche **Enforce HTTPS** quand la case devient disponible.

> Le nuage doit rester **gris** au moins jusqu'à ce que GitHub ait délivré le certificat HTTPS. Avec le nuage orange, GitHub n'arrive pas à vérifier le domaine.

**c. Relier l'application au script central**
Dans le dépôt, modifie `config.js` (crayon ✏️ sur GitHub) et colle l'URL `/exec` du script :
```js
API_URL: 'https://script.google.com/macros/s/XXXXXXXX/exec',
```
Clique sur *Commit changes* : le site est mis à jour en environ 1 minute. Tant que `API_URL` est vide, le site tourne en **mode démo**, avec des invités fictifs et le mot de passe `demo`.

**Adresses**
- Espace administrateur : **https://checkin.experiencemomento.com/admin.html**
- Scanner d'un mariage : `https://checkin.experiencemomento.com/index.html?e=…`, lien généré dans l'espace administrateur

## 3. Créer le scanner d'un mariage (2 minutes par mariage)

1. Prépare le Google Sheet des invités **dans le même compte Google** que le script, ou partage-le en *Éditeur* avec ce compte. La ligne d'en-tête doit contenir au minimum :
   `ID_Invitation`, `Nom_Invite`, `Numero_Table`. Les colonnes `QR_Code`, `Statut_Presence` et `Heure_scan` sont recommandées.
   Les colonnes `Appareil_scan` et `Mode_entree` sont ajoutées automatiquement si elles manquent.
2. Ouvre `admin.html`, connecte-toi, puis clique sur **+ Nouveau mariage**.
3. Remplis le formulaire :
   - le nom affiché et la date ;
   - le lien du Google Sheet et le nom de l'onglet (par exemple `Invites`) ;
   - le logo du mariage, la photo de fond de l'accueil, le style et la couleur de la date, et la couleur d'accent.

   L'aperçu à droite se met à jour en direct.
4. Clique sur **Enregistrer**. Le script vérifie le Google Sheet et affiche le nombre d'invités trouvés.
5. Copie le **lien du scanner**, ou fais scanner le QR affiché, et envoie-le aux hôtesses.

### Codes secrets (protection contre les faux QR)
- Le bouton **« Générer les codes secrets et mettre à jour les QR »** ajoute une colonne `Code_secret`. Chaque QR contient alors `FAINV-001.K7Q2XP` au lieu de `FAINV-001`, et les liens de la colonne `QR_Code` sont mis à jour.
- Fais-le **avant d'envoyer les invitations**, puisque les QR codes changent.
- L'option **« Exiger le code secret »** est alors activée : un QR sans code ou avec un code faux est refusé (« QR code non valide »).
- Pour un mariage dont les invitations sont déjà parties avec les anciens QR, laisse l'option **désactivée**.

## 4. Le jour du mariage

1. Chaque hôtesse ouvre le lien **avec internet** au moins une fois : la liste des invités, le logo et la photo sont alors enregistrés dans le téléphone.
2. À la première ouverture, elle donne un nom à son appareil (Entrée-1, Entrée-2…).
3. Conseil : *Partager → Sur l'écran d'accueil* (iPhone) ou *⋮ → Installer l'application* (Android), pour l'ouvrir comme une vraie application.
4. Fais un test : un scan, puis le même QR une deuxième fois, qui doit afficher l'alerte « Déjà scanné ».

### Comment le scanner fonctionne
- **Scan** : la fiche s'affiche immédiatement, puisque la recherche se fait dans le téléphone, et « Présent » est écrit dans le Google Sheet dans la foulée. Le bouton **Enregistré** fait revenir au scanner tout de suite ; sinon le retour est automatique au bout de 15 secondes.
- **Recherche** : la barre « Trouver un invité » tolère les fautes, les accents et l'ordre des mots. On peut aussi y taper un numéro (`23`) ou une table (`royaute`). On touche l'invité, puis **Marquer présent**. Le Google Sheet indique alors `Manuel` dans `Mode_entree`.
- **Déjà scanné** : une alerte rouge indique l'heure du premier passage et l'appareil qui l'a fait.
- **Synchronisation** : toutes les 8 secondes, chaque appareil envoie ses scans et récupère ceux des autres. Le bouton ⟳ force une mise à jour.
- **Hors-ligne** : le scanner continue de fonctionner. Les présences sont gardées en attente (« Hors ligne · 3 en attente ») et partent automatiquement au retour du réseau.

### Limite à connaître
Un appareil **hors-ligne** ne voit pas les scans des autres appareils. Si un même QR est présenté à deux appareils pendant une coupure, les deux l'acceptent. Au retour du réseau, le Google Sheet garde **le premier enregistrement**, et l'appareil concerné affiche un avertissement « ⚠ Doublon ». Pour l'éviter : un téléphone en partage de connexion pour tous les appareils.

## 5. En cas de problème

| Symptôme | Solution |
|---|---|
| « Mot de passe incorrect » | Vérifie `MOT_DE_PASSE_ADMIN` dans le script, puis publie une **nouvelle version** du déploiement. |
| « Colonne ID_Invitation introuvable » | Vérifie le nom de l'onglet et l'en-tête de la colonne A. |
| « You do not have permission » / Sheet inaccessible | Le Google Sheet doit appartenir au compte du script ou être partagé en *Éditeur* avec lui. |
| « Présent » n'est pas écrit | Si la colonne `Statut_Presence` a une liste déroulante, ajoute la valeur `Présent` à cette liste. |
| Caméra noire | Le site doit être en **https** (case *Enforce HTTPS* cochée sur GitHub). Autorise la caméra dans les réglages du navigateur. |
| Le sous-domaine ne s'ouvre pas | Vérifie la ligne CNAME `checkin` dans Cloudflare (nuage gris) et le *Custom domain* dans GitHub Pages. Le premier branchement peut prendre jusqu'à 30 minutes. |
| Un nouvel invité ajouté dans le Sheet n'apparaît pas | Touche ⟳ (internet nécessaire). |

## Contenu du dossier
```
apps-script/Code.gs      script central à coller dans Google Apps Script
index.html               scanner (lien envoyé aux hôtesses)
admin.html               espace administrateur
config.js                URL du script central (à remplir)
js, css, fonts, lib      code, styles, polices et lecteur QR, tout en local pour le mode hors-ligne
sw.js                    mise en cache pour l'utilisation sans internet
```
