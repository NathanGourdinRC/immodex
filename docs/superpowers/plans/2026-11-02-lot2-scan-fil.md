# Lot 2 : scan des sites et fil des annonces · plan de construction

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un robot sur le Vercel de Nathan lit chaque nuit, à rythme poli, les pages de résultats de 5 sources pour les communes de ses recherches, ouvre une fois chaque nouvelle annonce, retient prix et caractéristiques, détecte nouveautés, baisses et retraits ; le Fil de l'appli montre ces annonces, sans doublon, avec Garder et Écarter.

**Architecture:** Les annonces scannées sont des données publiques : elles sont rangées par commune dans Redis (`imx:scan:…`), pas dans l'espace de synchro de Nathan, et servies par `GET /api/listings`. Le scan (`api/scan.js`, tâche planifiée quotidienne) lit les communes des recherches des espaces actifs, lit les pages avec `jsdom` et réutilise le lecteur d'annonces de l'extension (`extract.js`, `generic-extract.js`) pour les pages d'annonce. Les statuts de Nathan (Garder, Écarter, note) restent dans la collection de synchro `track`, clé = adresse de l'annonce.

**Tech Stack:** Fonctions Vercel (Node, ESM), Upstash Redis REST (client de `api/sync.js`), `jsdom` (dépendance serveur seulement), `node --test`, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-02-recherches-scan-ventes-design.md` (§3, §6.1 à §6.3, §6.5, §8, §9).

## Global Constraints

- Une requête à la fois par site, **au moins 5 secondes** entre deux requêtes au même site ; `robots.txt` lu et respecté avant chaque site ; en-tête `User-Agent: ImmodexPlus/1.0 (+https://immodex.vercel.app ; usage personnel)`.
- Pages de résultats d'une (source, commune) relues au plus tous les 46 heures ; filtre commune + vente + type dans l'adresse, pas le budget ; au plus 5 pages par source, par commune et par passage.
- Page d'une annonce ouverte **une seule fois** (à sa découverte) ; jamais de relecture.
- Une annonce n'est comptée absente que si toutes les pages de résultats de sa source et de sa commune ont été lues à ce passage ; « retiré » après 2 passages absents.
- Une source qui répond 403, 429 ou par un défi anti-robot 2 passages de suite est mise en pause et signalée ; jamais de contournement.
- Au plus 30 communes suivies au total ; communes prises dans les recherches (collection `zone`) des espaces de synchro actifs depuis 21 jours.
- Conservation des annonces scannées : au moins 3 ans.
- Tout reste dans les offres gratuites : Vercel Hobby (tâche planifiée une fois par jour, fonction de 300 s au plus), Upstash gratuit.
- `jsdom` n'est utilisé que côté serveur ; l'extension reste sans dépendance.
- Interface en français, aucun tiret cadratin ; commits à chemins explicites terminés par `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Site lent ou en panne pendant un passage** : le passage ne compte pas pour les retraits de cette source et de cette commune ; aucune annonce marquée « retiré » à tort. Test tâche 4.
2. **Temps de fonction écoulé** au milieu des pages d'annonce : la file reprend au passage suivant, rien n'est perdu ni lu deux fois. Test tâche 4.
3. **Même bien sur deux sources** (Maes et Lesiteimmo) : une seule carte dans le Fil, deux liens. Test tâche 6.
4. **Annonce sans prix lisible** (« prix sur demande ») : gardée, prix « non précisé », jamais exclue par le budget. Tests tâches 2 et 6.
5. **Appel public répété de `/api/scan`** : un seul passage par 20 heures, quel que soit l'appelant. Test tâche 4.

---

### Task 1: Lecture d'une page avec jsdom (serveur)

**Files:**
- Create: `api/_lib/page.js`
- Modify: `package.json` (`jsdom` passe en `dependencies`), `vercel.json` (`installCommand`: `npm install --omit=dev`)
- Test: `tests/scan-page.test.mjs`

**Interfaces:**
- Produces:
  - `parseHtml(html: string, url: string) -> Document` (jsdom, scripts de la page non exécutés, erreurs CSS ignorées).
  - `readListing(html, url) -> { price, surface, pieces, chambres, terrain, garage: boolean, title, photo, postal, city, buildingType, energyClass, gesClass, energyConsumption, gesEmission }` : exécute `src/common/extract.js` puis `src/common/generic-extract.js` dans la fenêtre jsdom (comme `tests/helpers/dom.mjs`), prend `extractFromDocument` et `extractPrice` ; pièces, chambres, terrain et garage par expressions sur le texte de la page (`(\d+)\s*pi[eè]ces?`, `(\d+)\s*chambres?`, `terrain[^0-9]{0,30}(\d[\d\s]*)\s*m²`, `garage`) ; titre `h1` ou `og:title` ; photo `og:image`.
  - `priceOf(text: string) -> number | null` : prix d'un texte qui ne contient que le prix (`^(?:prix\s*:?\s*)?(\d{1,3}(?:[ .]\d{3}){1,2}|\d{4,7})\s?€$` sur le texte normalisé), sinon `null`.

- [ ] **Step 1: Tests** : `readListing` sur une page synthétique (h1, og:image, « 5 pièces », « 3 chambres », « Terrain 293 m² », « garage », DPE « 204 kWh/m².an », « 22 kg CO2 », « Prix : 332 000 € », « 59118 Wambrechies ») donne les bonnes valeurs ; `priceOf('299 500 €') === 299500`, `priceOf('13 299 500 €')` vaut `null` seulement si l'élément contient autre chose : ce test porte sur `priceOf('Prix sur demande') === null` et `priceOf('1 090 000 €') === 1090000`.
- [ ] **Step 2: Run** `node --test tests/scan-page.test.mjs` → FAIL (module absent)
- [ ] **Step 3: Implement** `api/_lib/page.js` ; `package.json` et `vercel.json` modifiés.
- [ ] **Step 4: Run** `npm test` → PASS
- [ ] **Step 5: Commit** `api/_lib/page.js package.json package-lock.json vercel.json tests/scan-page.test.mjs` « Scan : lecture d'une page d'annonce côté serveur »

### Task 2: Sources et lecteur de résultats

**Files:**
- Create: `api/_lib/sources.js`
- Test: `tests/scan-sources.test.mjs` (pages synthétiques reproduisant la structure de chaque source, quelques cartes chacune ; pas de copie des pages réelles)

**Interfaces:**
- Consumes: `parseHtml`, `priceOf` (tâche 1).
- Produces:
  - `SOURCES: Source[]`, `Source = { id: 'orpi' | 'paruvendu' | 'lesiteimmo' | 'maes' | 'deleu', label, host, listUrls(commune, type) -> string[], pageUrl(url, n) -> string | null, isListing(url: URL) -> boolean, communeOf?(card) }`. `commune = { code, nom, codesPostaux }` ; `type` `'maison' | 'appartement' | null` (null : les deux).
    - Orpi : `https://www.orpi.com/annonces-immobilieres-{slug}/vente-{maison|appartement}/`, annonces `/annonce-vente-…`.
    - ParuVendu : `https://www.paruvendu.fr/immobilier/vente/{maison|appartement}/{slug}-{cp}/`, annonces `/immobilier/vente/{type}/<id ≥ 6 chiffres>…`.
    - Lesiteimmo : `https://www.lesiteimmo.com/acheter/{maison|appartement}/{slug}-{cp}`, pages suivantes `?page=n`, annonces `/acheter/{type}-…/{slug}-{cp}/<id>`.
    - Maes : `https://www.maesimmobilier.fr/type_offre/vente/` (toutes communes), annonces `/bien-immobilier/…`, gardées si la carte cite la commune.
    - Deleu : `https://deleuimmobilier.com/fr/ventes`, pages `?page=n`, annonces `/fr/propriete/vente+{type}+{commune}+…`, commune lue dans l'adresse.
    - `slug` : minuscules, accents retirés, apostrophes et espaces en `-` ; `cp` : premier code postal de la commune.
  - `readResults(html, pageUrl, source, commune) -> { cards: { url, price: number | null, title }[], full: boolean }` : pour chaque lien d'annonce, la carte est le plus grand ancêtre qui ne contient des liens que vers cette annonce ; le prix est celui du premier élément de la carte dont tout le texte est un prix (`priceOf`). `full` : la page contient au moins autant de cartes que la taille habituelle de page de la source (Orpi 30, ParuVendu 25, Lesiteimmo 25, Deleu 12, Maes sans pagination : `false`).
- [ ] **Step 1: Tests** : pour chaque source, une page synthétique de 3 cartes dont une sans prix (« Prix sur demande ») et une où un compteur de photos précède le prix (« 13 » puis « 299 500 € ») ; attendu : 3 URL absolues sans paramètres, prix exacts, `null` pour la carte sans prix. `listUrls` pour Wambrechies (59636, 59118) et pour Annecy (74010, 74000) en maison, et deux adresses pour `type: null`.
- [ ] **Step 2: Run** → FAIL ; **Step 3: Implement** ; **Step 4: Run** `npm test` → PASS
- [ ] **Step 5: Commit** « Scan : les 5 sources et la lecture des pages de résultats »

### Task 3: Robot poli

**Files:**
- Create: `api/_lib/polite.js`
- Test: `tests/scan-polite.test.mjs`

**Interfaces:**
- Produces: `createPoliteFetcher({ fetchImpl, now, sleep, delayMs = 5000, userAgent = UA }) -> { get(url) -> Promise<{ ok, status, html, blocked: boolean, disallowed: boolean }> }`.
  - `robots.txt` lu une fois par hôte (règles `User-agent: *` et `ImmodexPlus`, règle la plus longue gagne) ; URL interdite : `{ disallowed: true }` sans requête.
  - Requêtes d'un même hôte en série, `delayMs` au moins entre deux ; hôtes différents en parallèle.
  - `blocked` : statut 403 ou 429, ou page contenant `captcha-delivery`, `datadome`, `cf-chl`, `Just a moment`.
  - `UA = 'ImmodexPlus/1.0 (+https://immodex.vercel.app ; usage personnel)'`.
- [ ] **Step 1: Tests** (horloge et `sleep` factices) : deux requêtes au même hôte espacées de 5 s, deux hôtes en parallèle sans attente, URL interdite par `robots.txt` jamais demandée, `robots.txt` absent (404) : tout autorisé, réponse DataDome : `blocked`.
- [ ] **Step 2–5** : FAIL, implémenter, PASS, commit « Scan : robot poli (robots.txt, 5 s entre deux pages, détection des blocages) »

### Task 4: Le passage de scan et son stockage

**Files:**
- Create: `api/_lib/scan-store.js`, `api/_lib/scan-run.js`, `api/scan.js`
- Modify: `api/sync.js` (enregistre l'activité de chaque espace dans le zset `imx:spaces`, score = date), `vercel.json` (`crons: [{ path: '/api/scan', schedule: '0 2 * * *' }]`, `functions: { 'api/scan.js': { maxDuration: 300 } }`)
- Test: `tests/scan-run.test.mjs` (Redis factice de `tests/sync.test.mjs`)

**Interfaces:**
- Consumes: `SOURCES`, `readResults` (tâche 2), `createPoliteFetcher` (tâche 3), `readListing` (tâche 1), `upstash` de `api/sync.js`.
- Produces:
  - Clés Redis : `imx:scan:{insee}:l` (hash : identifiant d'annonce → JSON), `imx:scan:{insee}:src` (hash : source → `{ lastRun, failures, paused, lastFull }`), `imx:scan:queue` (liste JSON `{ insee, source, url }`), `imx:scan:last` (date du dernier passage).
  - Annonce : `{ id, source, url, insee, type, title, photo, price, prices: [{ at, price }], surface, pieces, chambres, terrain, garage, postal, city, energyClass, gesClass, energyConsumption, gesEmission, firstSeen, lastSeen, missed, removedAt, detail: boolean }` ; `id` = source + identifiant de l'URL.
  - `activeCommunes(redis, now) -> commune[]` : recherches des espaces actifs depuis 21 jours, recherches sans commune ignorées, au plus 30 communes, les plus récentes d'abord.
  - `runScan({ redis, fetcher, now, budgetMs = 240000, clock }) -> { communes, results: number, details: number, removed: number, paused: string[], skipped?: 'recent' }` :
    1. refuse si `imx:scan:last` date de moins de 20 heures (`skipped: 'recent'`) ;
    2. pour chaque (source, commune, type) dont `lastRun` a plus de 46 h : pages de résultats (5 au plus), mise à jour des annonces (nouvelle : ajoutée + mise en file ; vue : `lastSeen`, nouveau prix ajouté à `prices` s'il change ; absente : `missed + 1` seulement si toutes les pages ont été lues sans erreur, `removedAt` à 2) ;
    3. file des pages d'annonce jusqu'à `budgetMs` ; une annonce lue passe à `detail: true` ; le reste attend le passage suivant ;
    4. blocage 2 passages de suite : `paused: true`.
  - `GET /api/scan` appelle `runScan` et renvoie son résumé en JSON (`Cache-Control: no-store`).
- [ ] **Step 1: Tests** : premier passage (2 sources factices) → annonces créées et mises en file, pages d'annonce lues dans le budget ; deuxième passage 47 h plus tard avec un prix changé et une annonce absente → `prices` à 2 entrées, `missed: 1` ; troisième passage → `removedAt` posé ; passage où une page de résultats échoue → aucune absence comptée ; budget épuisé → la file garde le reste, rien n'est relu ; second appel dans les 20 h → `skipped: 'recent'` ; source bloquée 2 fois → `paused` ; `activeCommunes` ignore les espaces inactifs et les recherches sans commune.
- [ ] **Step 2–5** : FAIL, implémenter, PASS, commit « Scan : passage quotidien, stockage par commune, nouveautés, baisses et retraits »

### Task 5: Adresse et position des annonces

**Files:**
- Modify: `api/_lib/scan-run.js` (après lecture d'une page d'annonce)
- Test: `tests/scan-run.test.mjs`

**Interfaces:**
- Consumes: `runLookup` de `src/common/match.js` (recherche ADEME de l'extension).
- Produces: champs `address`, `lat`, `lon`, `addressConfidence` de l'annonce, posés seulement si le meilleur candidat ADEME est unique et de confiance haute (même règle que le popup de l'extension) ; sinon absents.
- [ ] Tests avec un `lookup` injecté : candidat unique sûr → adresse et position ; plusieurs candidats → rien. FAIL, implémenter, PASS, commit « Scan : adresse probable des annonces par leur DPE »

### Task 6: Le Fil des annonces scannées

**Files:**
- Create: `api/listings.js`, `src/common/listings.js`
- Modify: `src/dashboard/feed.js`, `src/dashboard/dashboard.html`
- Test: `tests/listings.test.mjs`, `tests/e2e/extension.e2e.mjs`

**Interfaces:**
- Produces:
  - `GET /api/listings?insee=59636,59388` → `{ listings: Annonce[], sources: { [insee]: { [source]: { lastRun, paused } } } }`, `Cache-Control: public, max-age=300`.
  - `src/common/listings.js` : `LISTINGS_ENDPOINT`, `fetchListings(codes, { fetchImpl }) -> Promise<{ listings, sources }>`, `groupListings(listings) -> Group[]` (même bien : même source et même id, ou mêmes valeurs DPE et surface à 1 m² près, ou même commune, même type, surface à 1 m² près et prix à 5 % près : `probable: true`), `statusOf(group, previousVisit, now) -> 'retire' | 'baisse' | 'nouveau' | null` (retiré si toutes les annonces du groupe ont `removedAt` ; baisse si le dernier prix est sous le précédent ; nouveau si `firstSeen` après la visite précédente).
  - Fil : panneau « Annonces en vente » au-dessus de « Annonces vues » : cartes avec étiquette (« Nouveau », « Prix baissé de 20 000 € », « Retiré »), type, pièces, surface, terrain, prix, commune, sources (un lien par source), « en ligne depuis N jours », mentions `checkCriteria`, « Garder » / « Écarter » (clé de suivi : URL de la première annonce du groupe), ligne « Ventes proches » si l'annonce a une position ; ligne d'état « Dernier passage du robot : <date> » et sources en pause.
- [ ] **Step 1: Tests unitaires** : `groupListings` (même bien Maes + Lesiteimmo → 1 groupe à 2 liens ; deux biens voisins distincts → 2 groupes), `statusOf` (3 cas), `checkCriteria` avec pièces/chambres/terrain lus ; **e2e** : l'appel `/api/listings` est servi par Playwright (`context.route`) avec 3 annonces dont une retirée et une en baisse ; le Fil Wambrechies montre « Prix baissé de », « Retiré », un bouton « Garder » qui passe à « Gardé ».
- [ ] **Step 2–5** : FAIL, implémenter, PASS, commit « Fil : annonces scannées, nouveautés, baisses et retraits, sans doublon »

### Task 7: Version 0.12.0, mise en ligne, premier passage

- [ ] README (scan, sources, robot poli, `api/scan.js`, `api/listings.js`), version `0.12.0` dans `manifest.json` et `package.json`.
- [ ] `npm test && npm run test:e2e` → PASS ; push sur `main`.
- [ ] Après déploiement : appeler une fois `https://immodex.vercel.app/api/scan` (premier passage), lire le résumé ; vérifier `GET /api/listings?insee=59636` ; vérifier le Fil Wambrechies sur l'appli en ligne (WebKit iPhone 13).
