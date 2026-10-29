<div align="center">

# Immodex+

**Extension Chrome qui révèle l'adresse réelle d'une annonce immobilière (Leboncoin, Bienici, SeLoger, portails et agences du Lillois) à partir des registres publics ADEME et IGN. Gratuite et open source.**

*Fork de [tonoid/immodex](https://github.com/tonoid/immodex) maintenu par Nathan Gourdin (Releaf Carbon).*

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Chrome Web Store](https://img.shields.io/chrome-web-store/v/jeaigijadohgaaciphheaignoibieemg?label=chrome%20web%20store)](https://chromewebstore.google.com/detail/jeaigijadohgaaciphheaignoibieemg)
[![Chrome Web Store users](https://img.shields.io/chrome-web-store/users/jeaigijadohgaaciphheaignoibieemg?label=installs)](https://chromewebstore.google.com/detail/jeaigijadohgaaciphheaignoibieemg)
[![Made by tonoïd](https://img.shields.io/badge/made%20by-tono%C3%AFd-dc2626.svg)](https://www.tonoid.com/fr)

[Nouveautés d'Immodex+](#nouveautés-dimmodex) · [Installation](#installation) · [Utilisation](#utilisation) · [Comment ça marche](#comment-ça-marche) · [FAQ](#faq) · [Made by tonoïd](#made-by-tonoïd)

</div>

---

## Nouveautés d'Immodex+

| | Immodex (original) | Immodex+ |
| --- | --- | --- |
| Sites lus | Leboncoin, Bienici, SeLoger | + 15 portails et réseaux, 82 agences de la métropole lilloise et 89 sites du lac d'Annecy (voir [Utilisation](#utilisation)), et n'importe quelle annonce via « Analyser cette page » |
| Résultats après changement d'onglet | perdus | **historique 7 jours** (50 recherches), réaffiché à la réouverture du popup et sur l'annonce |
| Liens des autres candidats (popup) | aucun | Google Maps et fiche ADEME pour chaque candidat |
| Ville sans code postal (« Lille ») | impossible | codes postaux de la commune retrouvés automatiquement |
| Consommation (kWh/m²/an) affichée sur l'annonce | ignorée | **filtre précis** dans le registre ADEME, souvent décisif en ville dense |
| Lecture du registre | 20 lignes, ordre quelconque | 50 lignes, DPE les plus récents d'abord |
| DPE affiché en image | rien | la carte demande les lettres lues sur l'étiquette |
| Interface | style Pokédex | interface sobre : classes aux couleurs officielles du DPE, jauge de confiance, boutons Maps / ADEME / copier pour chaque candidat, bouton en onglet au bord droit (ne masque plus les bandeaux cookies) |
| Agence non couverte | rien | « Activer sur ce site » dans le popup : le bouton automatique y est ajouté en un clic |
| Annonce republiée (autre site, autre agence, nouvelle annonce) | invisible | **suivi des biens** : chaque annonce ouverte est mémorisée (12 mois, dans Chrome) ; un même bien retrouvé est signalé sur le bouton (« +2 ») avec ses parutions et l'évolution du prix ; onglet **Biens** du popup |
| Vérifier un candidat | lien Google Maps | + **Street View** à l'adresse de chaque candidat (comparer la façade aux photos) et **carte des candidats** numérotés (OpenStreetMap, dans un onglet) |
| Prix du marché | rien | **Ventes passées** à l'adresse de chaque candidat (DVF, 5 dernières années) : prix, surface, prix au m², vente de surface proche de l'annonce mise en avant, médianes de la rue et du secteur |
| Suivre une recherche sur des semaines | rien | **Tableau de bord** (bouton du popup) par zone de communes : nouveaux DPE de la zone (souvent une annonce en préparation), annonces vues avec statut et note, carte des prix médians au m² par section cadastrale |
| Sur le téléphone | rien | **appli téléphone** [immodex.vercel.app](https://immodex.vercel.app) : recherche d'adresse, historique, biens suivis et tableau de bord, **synchronisés avec l'extension** (bouton téléphone du popup, appairage par QR code) |
| Historique de prix partagé | rien | bouton **Castorus** : copie le lien de l'annonce et ouvre la recherche par URL de Castorus (pas d'API publique, pas de collecte automatique) |

Détails techniques et choix : [docs/plans/2026-10-25-historique-et-sites-nord.md](docs/plans/2026-10-25-historique-et-sites-nord.md).

---

## Problème résolu

Sur **Leboncoin, Bienici et SeLoger**, l'adresse précise d'une annonce immobilière est volontairement masquée pour forcer le contact avec l'agence. Pourtant, les informations affichées (surface, classes DPE et GES, code postal, contenance) suffisent à identifier le bien dans les registres publics. Faire ce recoupement à la main est laborieux.

## Proposition de valeur

Ouvre une annonce sur l'un des trois sites, clique sur le bouton Immodex, l'extension retrouve l'adresse exacte. Pour un **logement**, elle interroge le registre ADEME des DPE et croise les classes énergie, GES, surface et code postal. Pour un **terrain**, elle interroge le cadastre IGN puis localise la parcelle sur la photo aérienne. De une à cinq adresses candidates sont retournées, classées par score de confiance.

## Public cible

Investisseurs locatifs, acheteurs, chasseurs immobiliers, professionnels de l'immobilier qui veulent vérifier la localisation exacte d'un bien avant tout contact commercial.

## Modèle économique

Gratuite, open source sous licence MIT. Aucun compte, aucun pistage, aucune affiliation cachée. L'extension n'utilise que des APIs publiques de l'État français (`data.gouv.fr`, `data.ademe.fr`, IGN, DVF).

> 🇬🇧 **In English**: Immodex is a free, open-source Chrome extension that reveals the real address behind a French real-estate listing (Leboncoin, Bienici, SeLoger) using the public ADEME and IGN registries. For a dwelling, it cross-references the visible DPE data (energy class, GHG class, surface, postal code) with the national ADEME registry. For a parcel of land, it queries the IGN cadastre and the national address database (BAN). No account, no backend, no tracking.

---

## Installation

Immodex+ n'est pas publié sur le Chrome Web Store : il se charge en mode développeur.

```bash
git clone https://github.com/NathanGourdinRC/immodex
```
1. Va sur `chrome://extensions/`
2. Active le **mode développeur** (interrupteur en haut à droite)
3. Clique sur **Charger l'extension non empaquetée** et sélectionne le dossier `immodex/`
4. Si l'Immodex original du Chrome Web Store est installé, désactive-le pour éviter deux boutons sur les annonces

L'icône Immodex+ apparaît dans la barre d'outils. Pour une mise à jour : `git pull`, puis le bouton ↻ de la carte Immodex+ dans `chrome://extensions/`.

---

## Utilisation

### Détection automatique

Ouvre n'importe quelle annonce sur :

| Site | Maisons / Appart. | Terrains |
| --- | :---: | :---: |
| [Leboncoin](https://www.leboncoin.fr/) | ✓ | ✓ |
| [Bienici](https://www.bienici.com/) | ✓ | ✓ |
| [SeLoger](https://www.seloger.com/) | ✓ | ✓ |
| [Figaro Immobilier](https://immobilier.lefigaro.fr/), [PAP](https://www.pap.fr/), [ParuVendu](https://www.paruvendu.fr/), [Notaires](https://www.immobilier.notaires.fr/) | ✓ | ✓ |
| Réseaux : [IAD](https://www.iadfrance.fr/), [Orpi](https://www.orpi.com/), [Safti](https://www.safti.fr/), [Century 21](https://www.century21.fr/), [Laforêt](https://www.laforet.com/), [Foncia](https://fr.foncia.com/), [Citya](https://www.citya.com/), [Square Habitat](https://www.squarehabitat.fr/) | ✓ | ✓ |
| Agences de la métropole lilloise : [Vacherand](https://www.vacherand.fr/), [Abrinor](https://www.abrinor.fr/) et 80 autres, de Lille à Armentières, Roubaix, Tourcoing et Seclin (liste : [docs/agences-lilloises.json](docs/agences-lilloises.json)) | ✓ | ✓ |
| Lac d'Annecy : 72 agences d'Annecy (avec Annecy-le-Vieux, Seynod, Cran-Gevrier, Meythet et Pringy), Saint-Jorioz, Sévrier, Duingt et des communes voisines, 13 réseaux (ERA, Swixim, Barnes, Lamy, Sextant, Propriétés Privées…) et 4 portails (FNAIM, LeSiteImmo, 36 Heures Immo, French-Property). Liste, lecture mesurée et sites écartés : [docs/agences-annecy.json](docs/agences-annecy.json) | ✓ | ✓ |
| Tout autre site d'annonce (sites d'agences Apimo, Netty, La Boîte Immo…) | via « Analyser la page ouverte », ou bouton automatique après « Activer sur ce site » | idem |

Logic-Immo, Superimmo, MeilleursAgents et Efficity bloquent les robots : l'extension fonctionne quand même en navigation normale via « Analyser cette page », mais ces sites n'ont pas été testés.

Un bouton flottant **Immodex+** apparaît en bas à droite. Clique dessus :

- **Logement** : tu confirmes la date du DPE (facultatif, ça affine le score) et, si l'étiquette n'est qu'une image, les lettres énergie et GES puis Immodex te retourne 1 à 5 candidats classés par score de confiance, avec lien Google Maps et fiche ADEME.
- **Terrain** : Immodex interroge directement le cadastre IGN et te retourne 1 à 5 parcelles candidates, avec l'IDU, la section/numéro, l'adresse approximative (BAN reverse), et un lien vers Géoportail superposant le cadastre sur la photo aérienne.

### Recherche manuelle

Clique sur l'icône Immodex+ dans la barre d'outils : un popup s'ouvre avec cinq onglets (**Logement** / **Terrain** / **Historique** / **Biens** / **Sites**).

- **Analyser la page ouverte** lit l'annonce de l'onglet actif (n'importe quel site), remplit le formulaire et lance la recherche.
- Sur une agence non couverte, un bandeau propose **Activer** : Chrome demande l'autorisation pour ce seul site, puis le bouton automatique y apparaît à chaque visite. L'onglet **Sites** liste les sites intégrés et ceux que tu as ajoutés (avec « Retirer »).
- **Historique** liste les recherches des 7 derniers jours ; chacune se rouvre avec tous ses candidats et leurs liens.
- Fermer le popup (par exemple en cliquant sur un lien Google Maps) ne fait plus rien perdre : à la réouverture, le dernier résultat est réaffiché.

### Tests

```bash
npm install
npm test
npm run test:e2e
```

`npm test` lance les tests unitaires (historique, lecture des annonces, rapprochement ADEME, ventes DVF, zones du tableau de bord). `npm run test:e2e` charge l'extension dans un Chromium piloté et rejoue les parcours réels (API ADEME comprises) ; il faut d'abord `npx playwright install chromium`. L'extension elle-même n'a aucune dépendance : `node_modules` ne sert qu'aux tests.

---

## Comment ça marche

```
┌─ Annonce Leboncoin/Bienici/SeLoger ───────────────────────────────┐
│ • Extrait code postal, surface, classes DPE/GES, date DPE         │
│ • Détecte si c'est un logement ou un terrain                      │
└──────────────────────────┬────────────────────────────────────────┘
                           │
              ┌────────────┴────────────┐
              ▼                         ▼
        ┌──────────┐              ┌──────────┐
        │ LOGEMENT │              │ TERRAIN  │
        └────┬─────┘              └────┬─────┘
             │                         │
             ▼                         ▼
   ┌─────────────────────┐   ┌─────────────────────┐
   │ Registre ADEME      │   │ geo.api.gouv.fr     │
   │ data.ademe.fr       │   │ postal → INSEE      │
   │                     │   └─────────┬───────────┘
   │ Filtres :           │             │
   │ • code_postal       │             ▼
   │ • surface ±1-3 m²   │   ┌─────────────────────┐
   │ • etiquette_dpe     │   │ IGN apicarto        │
   │ • etiquette_ges     │   │ contenance ±5-20 m² │
   │ • date_etablissement│   └─────────┬───────────┘
   └────────┬────────────┘             │
            │                          ▼
            │                ┌─────────────────────┐
            │                │ BAN reverse         │
            │                │ centroïde → adresse │
            │                └─────────┬───────────┘
            ▼                          ▼
   ┌────────────────────────────────────────┐
   │ Scoring + dédup + tri par confiance    │
   │ → top 5 candidats affichés en overlay  │
   └────────────────────────────────────────┘
```

Trois tiers de tolérance (exact → élargi → très élargi) sont appliqués automatiquement pour maximiser les chances de match sans surcharger les APIs publiques.

### Sources de données

| Source | URL | Usage |
| --- | --- | --- |
| ADEME : registre DPE existants | `data.ademe.fr/data-fair/api/v1/datasets/dpe03existant` | Logements post-2021 |
| ADEME : registre DPE neufs | `data.ademe.fr/.../g3cgx7jb3cmys5voxz1mrm22` | Logements neufs |
| ADEME : registre DPE legacy | `data.ademe.fr/.../dpe-france` | Logements pré-2021 |
| IGN apicarto cadastre | `apicarto.ign.fr/api/cadastre/parcelle` | Parcelles cadastrales |
| BAN (Base Adresse Nationale) | `api-adresse.data.gouv.fr/reverse/` | Reverse geocoding |
| API Géo (Etalab) | `geo.api.gouv.fr/communes` | Code postal → INSEE |
| DVF (DGFiP, publié par Etalab) | `app.dvf.etalab.gouv.fr/api/mutations3` | Ventes passées par section cadastrale |
| Statistiques DVF (data.gouv.fr) | `tabular-api.data.gouv.fr` | Prix médian au m² par commune et par section |
| Cadastre Etalab | `cadastre.data.gouv.fr/bundler/cadastre-etalab` | Contours des sections cadastrales |

Toutes ces APIs sont **publiques, gratuites, sans clé**. Elles sont financées par l'État via data.gouv.fr.

---

## Cas d'usage

- 🏘️ **Investisseur locatif** : comparer le rendement réel selon le quartier avant de contacter l'agence
- 🔍 **Chasseur d'appartement** : vérifier que l'annonce n'est pas un duplicate ou un bait
- 📍 **Acheteur** : voir l'environnement immédiat (commerces, transports, nuisances) avant la visite
- 🏗️ **Auto-promoteur terrain** : identifier les parcelles correspondant à une annonce et accéder aux données cadastrales
- 🧭 **Chasseur immobilier pro** : accélérer le sourcing en court-circuitant la communication avec les agences

---

## Confidentialité

- **Pas de compte, pas de login, pas de tracking**
- **Aucune donnée n'est envoyée à des serveurs tiers** autres que les APIs publiques listées plus haut, et le serveur de synchro si tu l'actives
- **Synchro avec le téléphone (facultative)** : zones, suivi des biens (statut, note), annonces vues et recherches des 7 derniers jours passent par `immodex.vercel.app/api/sync` (fonction Vercel, base Upstash Redis à Francfort), rangés sous l'empreinte SHA-256 d'une clé aléatoire générée par l'extension. La clé n'existe que sur tes appareils (QR code d'appairage) ; sans elle, les données sont inaccessibles
- **Tout le code tourne dans le navigateur** (Manifest V3, service worker local)
- **Caches locaux uniquement** : `chrome.storage.session` pour le cache court (1 h), `chrome.storage.local` pour les parcelles (24 h)
- **Pas de publicité, pas d'affiliation cachée**

Code source 100 % auditable.

---

## Limites connues

- Fonctionne **uniquement sur les annonces françaises** des trois sites supportés
- Le matching DPE **nécessite un DPE valide** sur l'annonce (logements avant 2007 souvent exemptés)
- Dans les zones denses (Paris, Lyon, centre Marseille), plusieurs candidats peuvent partager les mêmes critères : Immodex retourne le top 5 et te laisse choisir visuellement
- L'API ADEME peut renvoyer des données obsolètes si le DPE a été refait sans que l'ancien ne soit retiré

---

## Développement

```bash
git clone https://github.com/tonoid/immodex
cd immodex
# pas de build, pas de dépendances
# charger le dossier dans chrome://extensions (mode développeur)
```

### Stack

- **Manifest V3**
- **Vanilla JS**, pas de build step, pas de framework
- Service worker en **ES modules**, content scripts en IIFE
- Aucune dépendance d'exécution

### Architecture

```
manifest.json           # Permissions + content scripts + service worker
icons/                  # Icônes PNG (sources SVG conservées pour edition)
src/
  background/
    service-worker.js   # Routeur LOOKUP, cache, concurrency
  common/
    extract.js          # Helpers d'extraction (postal, surface, classes…)
    ademe.js            # Client API ADEME
    apicarto.js         # Client IGN cadastre + centroïde
    geo.js              # INSEE resolution + BAN reverse
    match.js            # Tier escalation + scoring DPE & terrain
    sync.js             # Synchro avec l'appli téléphone (ombre, fusion, appairage)
  content/
    leboncoin.js        # Extraction depuis __NEXT_DATA__
    bienici.js          # Extraction depuis __INITIAL_STATE__
    seloger.js          # Extraction depuis __UFRN_LIFECYCLE_SERVERREQUEST__
  ui/
    overlay.js          # Overlay flottant (cards, button, navigation)
    overlay.css         # Look Pokédex (chassis rouge + LCD vert)
  popup/
    popup.html/.css/.js # Recherche manuelle (popup d'extension)
api/
  sync.js               # Fonction Vercel de synchro (Upstash Redis)
web/                    # Appli téléphone : les pages de src/ + adaptateur web (platform/)
scripts/build-web.mjs   # Construit dist-web/ pour Vercel
```

### Build local du zip

```bash
./scripts/build.sh
# → dist/immodex-<version>.zip
```

Le script lit la version depuis `manifest.json`, valide la syntaxe de tous les `.js`, et produit un zip prêt à uploader sur https://chrome.google.com/webstore/devconsole.

### Workflow de release

Les commits suivent [conventional-commits](https://www.conventionalcommits.org/). Sur push vers `main`, [release-please](https://github.com/googleapis/release-please-action) ouvre une PR de release qui, une fois mergée, tag la version + publie une release GitHub + envoie le zip au Chrome Web Store automatiquement.

Détails dans [`.github/RELEASING.md`](.github/RELEASING.md).

---

## FAQ

### Est-ce que c'est légal ?
Oui. Immodex utilise **uniquement des données publiques** mises à disposition par l'État français via [data.gouv.fr](https://www.data.gouv.fr/) et [data.ademe.fr](https://data.ademe.fr/). Le registre ADEME et le cadastre IGN sont consultables gratuitement par n'importe quel citoyen. Immodex automatise simplement le recoupement.

### Où installer l'extension ?
Sur le Chrome Web Store : [chromewebstore.google.com/detail/jeaigijadohgaaciphheaignoibieemg](https://chromewebstore.google.com/detail/jeaigijadohgaaciphheaignoibieemg). Si tu préfères, tu peux aussi charger le code source en mode développeur (voir [Installation](#installation)).

### Ça marche aussi sur Firefox ?
Pas encore. Une version `web-ext` est dans la roadmap.

### Est-ce que ça marche sur les annonces de location ?
Oui, dès qu'elles affichent un DPE (donc essentiellement toutes les locations résidentielles depuis 2007).

### Pourquoi plusieurs candidats sont retournés ?
Dans les zones denses, plusieurs logements peuvent partager le même code postal + surface + classe DPE. Immodex utilise un système de score (0-100) qui combine surface exacte, date du DPE, classes, et type de bâtiment pour classer les candidats. La confiance est codée par couleur :
- 🟢 **Vert** : score ≥ 80 et écart au 2e candidat ≥ 20 points
- 🟡 **Jaune** : score 50-79
- 🔴 **Rouge** : score < 50

### Est-ce que mon adresse de recherche est enregistrée quelque part ?
Non, sauf si tu actives la synchro avec le téléphone : tes recherches des 7 derniers jours, tes zones et ton suivi des biens sont alors gardés sur le serveur de synchro, sous ta clé. Les caches restent dans le navigateur. Aucune télémétrie n'est envoyée.

### Comment contribuer ?
PRs et issues bienvenues. Les commits doivent suivre [conventional-commits](https://www.conventionalcommits.org/). Lance les checks localement avec `node --check src/**/*.js` (ou la CI s'en charge).

### J'ai un bug / une suggestion
Ouvre une issue : https://github.com/tonoid/immodex/issues

---

## Licence

[MIT](LICENSE) © [tonoïd](https://www.tonoid.com/fr)

Tu peux **forker, modifier, redistribuer, vendre** : du moment que tu gardes la mention de copyright. Pas d'obligation de partager tes changements.

---

## Made by tonoïd

<a href="https://www.tonoid.com/fr">
  <img src="https://img.shields.io/badge/tono%C3%AFd-microstartup%20studio-dc2626?style=for-the-badge" alt="tonoïd" />
</a>

**Immodex est un projet [tonoïd](https://www.tonoid.com/fr)** : un studio de micro-SaaS et d'outils open source pour particuliers et freelances. On construit des outils simples, ciblés, qui résolvent un problème précis.

### Autres projets tonoïd

| Projet | Description |
| --- | --- |
| [**2sync**](https://2sync.com) | Synchronisation à double sens entre Notion et les outils que vous utilisez déjà (agenda, gestionnaires de tâches). |
| [**RefurbMe**](https://www.refurb.me) | Le plus grand comparateur de produits Apple reconditionnés. |
| [**Sens de la marche**](https://sensdelamarche.fr) | Vérifie si ta place TGV est dans le sens de la marche avant de réserver. Outil gratuit pour voyageurs SNCF. |
| [**Tetris.Casa**](https://tetris.casa) | Dessine un plan d'architecte comme on empile des Tetris. Gratuit, dans le navigateur, sans compte. |

→ Voir tous les projets sur **[tonoid.com/fr](https://www.tonoid.com/fr)**

---

<div align="center">

**[⬆ retour en haut](#immodex)**

Made with ❤️ in France · [tonoid.com/fr](https://www.tonoid.com/fr)

</div>
