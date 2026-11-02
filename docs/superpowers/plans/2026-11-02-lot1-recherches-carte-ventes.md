# Lot 1 : recherches, carte par secteurs et ventes passées · plan de construction

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transformer le tableau de bord « zones » d'Immodex+ en « Mes recherches » : critères complets, trois vues (Fil, Carte, Ventes passées), carte en secteurs hexagonaux de 400 m en 3 niveaux, ventes DVF avec prix au m², terrain et dépendance, fourchette des 15 ventes les plus proches. Aucun scan serveur dans ce lot.

**Architecture:** Les zones deviennent des recherches en étendant l'objet de `src/common/zones.js` (même clé de stockage, même collection de synchro `zone`). Deux modules purs nouveaux (`sales.js` pour charger les ventes DVF d'une commune, `sectors.js` pour les secteurs et le voisinage) alimentent un tableau de bord découpé en fichiers par vue. Tout tourne dans le navigateur (extension et appli téléphone), sur les API publiques déjà utilisées.

**Tech Stack:** JavaScript ES modules sans dépendance dans l'extension, Leaflet (copié dans `src/vendor/leaflet`), `node --test` pour les tests unitaires, Playwright (canal `chromium`) pour les tests de bout en bout.

**Spec:** `docs/superpowers/specs/2026-11-02-recherches-scan-ventes-design.md` (sections 5, 7.1 à 7.4 et 8 ; le reste concerne les lots suivants).

## Global Constraints

- Interface en français. Aucun tiret cadratin « — » dans le code, les textes ou les commits.
- L'extension n'a aucune dépendance à l'exécution : rien à installer, Leaflet reste celui de `src/vendor/leaflet`.
- Aucune donnée ne part ailleurs que vers les API publiques déjà utilisées (geo.api.gouv.fr, cadastre.data.gouv.fr, app.dvf.etalab.gouv.fr, ADEME, api-adresse.data.gouv.fr, IGN) et la synchro existante.
- Le `noindex` de `vercel.json` ne change pas.
- Aucune donnée existante perdue : une zone enregistrée avant ce lot s'ouvre comme une recherche, avec ses communes, son type et sa surface.
- Textes fixés par la spec : « Mes recherches », « Nouvelle recherche », « Fil », « Carte », « Ventes passées », « Garder », « Écarter », « Bientôt en vente ? », « moins cher », « dans la moyenne », « plus cher », « terrain non précisé », « chambres non précisées », « pièces non précisées », « dépendance ».
- Valeurs fixées par la spec : hexagones de rayon 220 m ; couleur seulement à partir de 10 ventes ; niveaux à ±10 % de la médiane de la commune ; 15 ventes les plus proches ; fourchette du 25e au 75e centile ; marge de 3 m² sur la surface habitable ; budget strict.
- Commits : chemins explicites (jamais `git add -A`), message en français, terminé par la ligne `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Tests : `npm test` (unitaires) et `npm run test:e2e` (bout en bout, vraies API publiques) doivent passer à la fin de chaque tâche qui les touche.

## Review Focus

1. **Commune nouvelle à préfixes cadastraux multiples** (Annecy, 74010, issue de la fusion de 6 communes) : les sections ont des préfixes autres que `000` ; la clé DVF doit les garder (`74010/182AB`). Test dans la tâche 2.
2. **Commune sans données DVF** (Bas-Rhin, Haut-Rhin, Moselle, Mayotte, absents de DVF) ou commune trop grande : la vue Ventes passées et la carte affichent un message clair au lieu d'une carte vide muette. Tests dans les tâches 2 et 6.
3. **Vente sans coordonnées** : elle reste dans le tableau des ventes mais n'entre ni dans un secteur ni dans le voisinage. Test dans la tâche 3.
4. **Recherche de type « indifférent »** : secteurs et ventes portent sur maisons et appartements ensemble, sans planter. Test dans la tâche 3.
5. **Secteur à cheval sur deux communes** : son niveau se compare à la médiane de la commune majoritaire du secteur. Test dans la tâche 3.

---

### Task 1: Recherche : critères complets et contrôle d'une annonce

**Files:**
- Modify: `src/common/zones.js` (`cleanZone`, nouvel export `checkCriteria`)
- Test: `tests/zones.test.mjs`

**Interfaces:**
- Produces:
  - `cleanZone(input, now)` renvoie en plus `budgetMin`, `budgetMax`, `terrainMin`, `terrainMax` (nombres ou `null`, min et max remis dans l'ordre comme la surface), `piecesMin`, `chambresMin` (entiers ≥ 1 ou `null`). Les champs existants ne changent pas.
  - `checkCriteria(listing, search) -> { ok: boolean, unknown: string[] }` où `listing = { price, surface, terrain, pieces, chambres }` (chacun nombre ou `null`). `ok` est faux dès qu'un critère renseigné de la recherche est contredit ; `unknown` liste, parmi les critères renseignés de la recherche, ceux que l'annonce ne précise pas, avec les libellés exacts `'terrain non précisé'`, `'chambres non précisées'`, `'pièces non précisées'`, `'prix non précisé'`, `'surface non précisée'`.

- [ ] **Step 1: Write the failing tests**

```js
test('recherche nettoyée : budget, terrain, pièces et chambres', () => {
  const z = cleanZone({ communes: [LILLE], budgetMin: '500000', budgetMax: 300000, terrainMin: '200', piecesMin: '4', chambresMin: '0' }, 1000);
  assert.equal(z.budgetMin, 300000);
  assert.equal(z.budgetMax, 500000);
  assert.equal(z.terrainMin, 200);
  assert.equal(z.terrainMax, null);
  assert.equal(z.piecesMin, 4);
  assert.equal(z.chambresMin, null);
});

test('ancienne zone sans les nouveaux champs : toujours valide', () => {
  const z = cleanZone({ id: 'z1', name: 'Lille', communes: [LILLE], type: 'maison', surfaceMin: 90, createdAt: 5 }, 1000);
  assert.equal(z.id, 'z1');
  assert.equal(z.surfaceMin, 90);
  assert.equal(z.budgetMax, null);
});

test('annonce et critères : budget strict, surface à 3 m², inconnues signalées', () => {
  const s = cleanZone({ communes: [LILLE], budgetMax: 450000, surfaceMin: 100, terrainMin: 150, chambresMin: 3 });
  assert.deepEqual(checkCriteria({ price: 440000, surface: 98, terrain: null, pieces: 5, chambres: null }, s), { ok: true, unknown: ['terrain non précisé', 'chambres non précisées'] });
  assert.equal(checkCriteria({ price: 450001, surface: 120 }, s).ok, false);
  assert.equal(checkCriteria({ price: 400000, surface: 96 }, s).ok, false);
  assert.equal(checkCriteria({ price: 400000, surface: 110, terrain: 100 }, s).ok, false);
  assert.deepEqual(checkCriteria({ price: null, surface: 110, terrain: 200, chambres: 3 }, s), { ok: true, unknown: ['prix non précisé'] });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/zones.test.mjs`
Expected: FAIL (`checkCriteria` is not exported, `budgetMin` undefined)

- [ ] **Step 3: Implement in `src/common/zones.js`**

`cleanZone` lit les nouveaux champs avec `numberOrNull` (entiers arrondis pour pièces et chambres) et remet min et max dans l'ordre comme pour la surface. `checkCriteria` : budget comparé sans marge ; surface habitable avec la marge de 3 m² de `fpInZone` ; terrain, pièces, chambres sans marge. Ajouter `checkCriteria` à l'`export`.

- [ ] **Step 4: Run to verify they pass**

Run: `npm test`
Expected: PASS, aucune régression

- [ ] **Step 5: Commit**

```bash
git add src/common/zones.js tests/zones.test.mjs
git commit -m "Recherche : budget, terrain, pièces et chambres, contrôle d'une annonce"
```

---

### Task 2: Ventes DVF d'une commune

**Files:**
- Modify: `src/common/dvf.js` (`slimRow`, `groupMutations`, export `sectionKeyFromId`)
- Create: `src/common/sales.js`
- Test: `tests/dvf.test.mjs`, `tests/sales.test.mjs`

**Interfaces:**
- Consumes: `communeSections(insee)` de `src/common/zone-data.js` (GeoJSON, `feature.properties.id` du type `596360000A`).
- Produces:
  - `slimRow(r)` garde en plus `lon`, `lat` (nombres ou `null`, champs `longitude`, `latitude` de l'API) et `culture` (`nature_culture`).
  - `groupMutations(rows)` : `terrain` devient la **somme** des surfaces de terrain des couples distincts (parcelle, culture), au lieu du maximum ; chaque vente porte `lon`, `lat` (ceux d'une ligne de logement, sinon de la première ligne qui en a) et `commune` (5 premiers caractères de la parcelle).
  - `sectionKeyFromId(id: string) -> string | null` : `'596360000A'` donne `'59636/0000A'` ; `'74010182AB'` donne `'74010/182AB'` ; une chaîne qui n'a pas 10 caractères valides donne `null`.
  - `sales.js` : `toSales(mutations, type) -> Sale[]` et `communeSales(insee, { type, fetchSections, fetchRows, maxSections = 60 }) -> Promise<{ sales: Sale[], sections: number, loaded: number, partial: boolean, lastDate: string | null }>`.
  - `Sale = { id, date, commune, address, price, type: 'Maison' | 'Appartement', surface, pieces, terrain, dependances, pricePerM2, lon, lat }`. Seules les ventes (`nature === 'Vente'`) d'un seul logement du type voulu (`'maison'` donne `Maison`, `'appartement'` donne `Appartement`, `null` les deux) avec un prix au m² entre 300 et 30 000 € entrent dans la liste.
  - `fetchSections` et `fetchRows` sont injectables pour les tests ; par défaut `communeSections` et le chargement par section de `dvf.js` (exporter `sectionRows`). Au plus 4 sections chargées en même temps ; au-delà de `maxSections`, `partial: true`.

- [ ] **Step 1: Write the failing tests**

Dans `tests/dvf.test.mjs`, compléter l'aide `row(o)` avec `longitude`, `latitude`, `nature_culture`, puis :

```js
test('terrain d’une vente : somme des parcelles distinctes, sans double compte', () => {
  const [m] = groupMutations([
    row({ id: 'm1', date: '2024-03-01', price: 300000, type: 'Maison', surface: 100, parcelle: '596360000B0001', terrain: 120, culture: 'sols' }),
    row({ id: 'm1', date: '2024-03-01', price: 300000, type: 'Dépendance', parcelle: '596360000B0001', terrain: 120, culture: 'sols' }),
    row({ id: 'm1', date: '2024-03-01', price: 300000, parcelle: '596360000B0002', terrain: 80, culture: 'jardins' }),
  ].map(slimRow));
  assert.equal(m.terrain, 200);
  assert.equal(m.dependances, 1);
  assert.equal(m.commune, '59636');
});

test('clé DVF d’une section cadastrale, préfixe de commune fusionnée compris', () => {
  assert.equal(sectionKeyFromId('596360000A'), '59636/0000A');
  assert.equal(sectionKeyFromId('74010182AB'), '74010/182AB');
  assert.equal(sectionKeyFromId('5963'), null);
});
```

Dans `tests/sales.test.mjs` (nouveau), avec des sections et des lignes factices :

```js
test('ventes d’une commune : maisons seules, coordonnées gardées, date la plus récente', async () => { /* 2 sections, 3 ventes dont 1 appartement et 1 vente groupée de 2 maisons */
  const r = await communeSales('59636', { type: 'maison', fetchSections, fetchRows });
  assert.equal(r.sales.length, 1);
  assert.deepEqual([r.sales[0].lon, r.sales[0].lat], [3.05, 50.68]);
  assert.equal(r.lastDate, '2025-12-30');
  assert.equal(r.partial, false);
});

test('commune sans ventes ou trop grande : liste vide, partielle signalée', async () => {
  assert.deepEqual((await communeSales('67482', { type: 'maison', fetchSections: async () => ({ features: [] }), fetchRows })).sales, []);
  const big = await communeSales('59350', { type: null, fetchSections: manySections(70), fetchRows, maxSections: 60 });
  assert.equal(big.loaded, 60);
  assert.equal(big.partial, true);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/dvf.test.mjs tests/sales.test.mjs`
Expected: FAIL (terrain 120 au lieu de 200, `sectionKeyFromId` et `sales.js` absents)

- [ ] **Step 3: Implement**

Modifier `slimRow` et `groupMutations` dans `src/common/dvf.js` ; vérifier que `summarize` et `market` gardent leur comportement (les tests existants de `tests/dvf.test.mjs` doivent rester verts). Créer `src/common/sales.js` avec `toSales` et `communeSales` ; un commentaire d'en-tête en français comme les autres modules.

- [ ] **Step 4: Run to verify they pass**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/common/dvf.js src/common/sales.js tests/dvf.test.mjs tests/sales.test.mjs
git commit -m "Ventes DVF d'une commune : coordonnées, terrain additionné, sections des communes fusionnées"
```

---

### Task 3: Secteurs et voisinage

**Files:**
- Create: `src/common/sectors.js`
- Test: `tests/sectors.test.mjs`

**Interfaces:**
- Consumes: `Sale` (tâche 2), `cleanZone` (tâche 1).
- Produces:
  - `HEX_RADIUS_M = 220`, `MIN_SALES = 10`, `LEVEL_GAP = 0.1`, `NEAREST = 15`.
  - `buildSectors(sales, { radius = HEX_RADIUS_M, minSales = MIN_SALES, gap = LEVEL_GAP } = {}) -> { sectors: Sector[], communeMedians: Record<string, number> }`.
  - `Sector = { key: string, center: [lat, lon], polygon: [lat, lon][] (6 sommets), count: number, median: number | null, level: 'moins' | 'moyenne' | 'plus' | null, commune: string, sales: Sale[] }`. `median` et `level` sont `null` sous `minSales` ventes. `commune` = la commune la plus représentée dans le secteur ; `level` compare `median` à `communeMedians[commune]` : `'moins'` si au moins `gap` en dessous, `'plus'` si au moins `gap` au-dessus, sinon `'moyenne'`.
  - `nearestSales(sales, { lat, lon }, k = NEAREST) -> { sales: Sale[], radius: number (m), p25: number, median: number, p75: number } | null` (`null` s'il y a moins de 5 ventes géolocalisées).
  - `isComparable(sale, search) -> boolean` : surface dans `[surfaceMin - 3, surfaceMax + 3]`, `pieces >= piecesMin`, terrain dans `[terrainMin, terrainMax]` ; un critère vide de la recherche est ignoré.
- Algorithme fixé (le reste est libre) : projection plane locale autour du centre moyen des ventes (x = Δlon × cos(lat0) × 111 320 m, y = Δlat × 110 540 m) ; hexagones « pointe en haut » en coordonnées axiales, arrondi cubique :

```js
const q = ((Math.sqrt(3) / 3) * x - y / 3) / R, r = ((2 / 3) * y) / R;
let rx = Math.round(q), rz = Math.round(r); const ry = Math.round(-q - r);
const dx = Math.abs(rx - q), dz = Math.abs(rz - r), dy = Math.abs(ry + q + r);
if (dx > dy && dx > dz) rx = -ry - rz; else if (dy <= dz) rz = -rx - ry;
// centre : x = R·√3·(rx + rz/2), y = R·1,5·rz ; sommets à 60°·i − 30°
```

- [ ] **Step 1: Write the failing tests**

```js
// Grappe de 12 ventes à ~3 000 €/m² au point A, 12 à ~3 600 €/m² au point B à 1 km, 3 ventes isolées, 1 sans coordonnées.
test('secteurs : nombre de ventes, niveau par rapport à la commune, peu de ventes sans niveau', () => {
  const { sectors, communeMedians } = buildSectors(sales);
  const a = sectors.find((s) => s.count === 12 && s.median < 3200);
  const b = sectors.find((s) => s.count === 12 && s.median > 3400);
  assert.equal(a.level, 'moins');
  assert.equal(b.level, 'plus');
  assert.ok(sectors.filter((s) => s.count < 10).every((s) => s.level === null && s.median === null));
  assert.equal(sectors.reduce((n, s) => n + s.count, 0), 27);
  assert.ok(communeMedians['59636'] > 3200 && communeMedians['59636'] < 3400);
  assert.equal(a.polygon.length, 6);
});

test('secteur à cheval sur deux communes : comparé à la commune majoritaire', () => {
  // 8 ventes 59636 et 4 ventes 59388 au même point C, plus les ventes des grappes A et B (59636).
  const { sectors } = buildSectors([...sales, ...mixedCommunesAtC]);
  const c = sectors.find((s) => s.sales.some((v) => v.commune === '59388'));
  assert.equal(c.commune, '59636');
  assert.equal(c.count, 12);
});

test('type indifférent : maisons et appartements mélangés sans erreur', () => {
  const mixed = sales.map((v, i) => ({ ...v, type: i % 2 ? 'Appartement' : 'Maison' }));
  const { sectors } = buildSectors(mixed);
  assert.equal(sectors.reduce((n, s) => n + s.count, 0), mixed.filter((v) => v.lat != null).length);
});

test('15 ventes les plus proches : fourchette et rayon', () => {
  const n = nearestSales(sales, { lat: A.lat, lon: A.lon });
  assert.equal(n.sales.length, 15);
  assert.ok(n.p25 <= n.median && n.median <= n.p75);
  assert.ok(n.radius > 0);
  assert.equal(nearestSales(sales.slice(0, 3), { lat: A.lat, lon: A.lon }), null);
});

test('vente comparable aux critères de la recherche', () => {
  const s = cleanZone({ communes: [WAMB], surfaceMin: 90, surfaceMax: 140, piecesMin: 4, terrainMin: 100 });
  assert.ok(isComparable({ surface: 88, pieces: 4, terrain: 150 }, s));
  assert.ok(!isComparable({ surface: 120, pieces: 3, terrain: 150 }, s));
  assert.ok(!isComparable({ surface: 120, pieces: 5, terrain: 50 }, s));
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/sectors.test.mjs`
Expected: FAIL (module absent)

- [ ] **Step 3: Implement `src/common/sectors.js`** (pur, sans accès réseau ni DOM)

- [ ] **Step 4: Run to verify they pass**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/common/sectors.js tests/sectors.test.mjs
git commit -m "Secteurs hexagonaux de 400 m en 3 niveaux et ventes les plus proches"
```

---

### Task 4: « Mes recherches » : renommage et formulaire complet

**Files:**
- Modify: `src/dashboard/dashboard.js` (`renderTabs`, `showEditor`, textes), `src/dashboard/dashboard.html` (titre, sous-titre, `aria-label`), `src/popup/popup.js` et `src/popup/popup.html` (bouton du tableau de bord)
- Test: `tests/e2e/extension.e2e.mjs` (test « tableau de bord »)

**Interfaces:**
- Consumes: `cleanZone` étendu (tâche 1) via `store.save`.
- Produces: formulaire qui enregistre `budgetMin`, `budgetMax`, `surfaceMin`, `surfaceMax`, `terrainMin`, `terrainMax`, `piecesMin`, `chambresMin`. Champs repérables par leur `name` : `budgetMin`, `budgetMax`, `surfaceMin`, `surfaceMax`, `terrainMin`, `terrainMax`, `piecesMin`, `chambresMin`.

- [ ] **Step 1: Update the e2e test first**

Dans le test « tableau de bord », remplacer `Créer la zone` par `Créer la recherche`, remplir aussi `input[name="budgetMax"]` (`450000`) et `input[name="piecesMin"]` (`2`), puis après rechargement vérifier que le formulaire « Modifier » reprend `450000` et `2`. Vérifier que le bouton du popup affiche « Mes recherches ».

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:e2e`
Expected: FAIL sur `button:has-text("Créer la recherche")`

- [ ] **Step 3: Implement**

Textes : « Mes recherches » (sous-titre et bouton du popup), « Nouvelle recherche », « Créer la recherche », « Modifier la recherche », « Nom de la recherche ». Le mot « zone » disparaît de l'interface (pas des noms de code ni des clés de stockage). Champs groupés par paires mini et maxi comme la surface ; budget en euros.

- [ ] **Step 4: Run to verify it passes**

Run: `npm test && npm run test:e2e`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/dashboard/dashboard.js src/dashboard/dashboard.html src/popup/popup.js src/popup/popup.html tests/e2e/extension.e2e.mjs
git commit -m "Mes recherches : critères complets dans le formulaire, le mot zone disparaît de l'interface"
```

---

### Task 5: Les trois vues et le Fil

**Files:**
- Create: `src/dashboard/feed.js`
- Modify: `src/dashboard/dashboard.js` (`openZone` découpé : en-tête, sélecteur de vue, délégation), `src/dashboard/dashboard.html` (styles des vues)
- Test: `tests/e2e/extension.e2e.mjs`

**Interfaces:**
- Consumes: `checkCriteria` (tâche 1), `groupsInZone`, `trackingKey`, `store.setTracking` existants ; `fetchNewDpe` existant.
- Produces:
  - `renderFeed({ search, token, isCurrent, body, layers, focus }) -> Promise<void>` dans `feed.js`.
  - Sélecteur de vue `.imx-seg` avec trois boutons « Fil », « Carte », « Ventes passées » ; la vue courante est gardée dans l'adresse (`#zone=<id>&vue=fil|carte|ventes`) ; la classe `view-fil`, `view-carte` ou `view-ventes` est posée sur `body`.
- Comportement fixé :
  - Fil = annonces vues dans la recherche (`groupsInZone` puis `checkCriteria` avec `price: g.lastPrice`, `surface: fp.surface`, le reste `null`), puis la section « Bientôt en vente ? » (nouveaux DPE de la recherche, période 15, 30 ou 90 jours comme aujourd'hui).
  - Chaque annonce : boutons « Garder » (statut `favori`) et « Écarter » (statut `ecarte`), mentions de `unknown` sous le prix, note conservée. Les annonces écartées sont masquées, avec un bouton « Afficher les écartées (n) ». Les annonces que `checkCriteria` refuse ne s'affichent pas.
  - Interrupteur « Masquer “Bientôt en vente ?” », mémorisé par appareil (`localStorage`, lecture et écriture protégées par `try/catch`).
  - Écran étroit (≤ 900 px) : la carte n'est visible que dans la vue Carte ; écran large : carte toujours visible à droite.

- [ ] **Step 1: Update the e2e test first**

Dans le test « tableau de bord » : remplacer la sélection de statut par un clic sur `button:has-text("Garder")`, vérifier `/1 favori/` dans les indicateurs ; cliquer « Écarter » sur la même annonce et vérifier qu'elle disparaît et que « Afficher les écartées (1) » apparaît ; vérifier que les boutons « Fil », « Carte », « Ventes passées » existent et que `#zone=…&vue=carte` est dans l'adresse après un clic sur « Carte ».

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:e2e`
Expected: FAIL sur `button:has-text("Garder")`

- [ ] **Step 3: Implement**

Déplacer `loadDpe`, `loadBiens`, `bienRow`, `priceLine`, `geocode` dans `feed.js` ; `dashboard.js` garde la carte, l'état, l'éditeur et l'aiguillage des vues.

- [ ] **Step 4: Run to verify it passes**

Run: `npm test && npm run test:e2e`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/dashboard/feed.js src/dashboard/dashboard.js src/dashboard/dashboard.html tests/e2e/extension.e2e.mjs
git commit -m "Recherche en trois vues : Fil avec Garder et Écarter, Bientôt en vente ?"
```

---

### Task 6: Carte en secteurs

**Files:**
- Create: `src/dashboard/sector-layer.js`
- Modify: `src/dashboard/dashboard.js` (couches Leaflet, retrait de la couche des sections et de `loadMarket`), `src/dashboard/dashboard.html` (styles de légende)
- Test: `tests/e2e/extension.e2e.mjs` (nouveau test « carte en secteurs : Wambrechies »)

**Interfaces:**
- Consumes: `communeSales` (tâche 2), `buildSectors` (tâche 3).
- Produces:
  - `loadSearchSales(search) -> Promise<{ sales: Sale[], partial: boolean, lastDate: string | null, failed: string[] }>` dans `sector-layer.js`, mis en cache par recherche pendant la session de la page (réutilisé par la tâche 7).
  - `renderSectors({ search, token, isCurrent, layer, body }) -> Promise<void>` : polygones Leaflet de classe `imx-sector` et `is-moins`, `is-moyenne`, `is-plus` ou `is-peu` ; nombre de ventes au centre de chaque secteur ; bulle au clic avec le niveau en toutes lettres, la médiane, le nombre de ventes et la liste des 20 plus récentes (date, rue, €/m², terrain, dépendance).
  - Vue « Carte » du panneau : légende (3 niveaux, hachuré « moins de 10 ventes »), médiane de chaque commune et nombre de ventes, date de la vente la plus récente (« Ventes connues jusqu'au 30/12/2025 »), avertissement si `partial` (« Commune trop grande : carte partielle ») ou si aucune vente (« Pas de données DVF pour cette commune (Alsace, Moselle et Mayotte n'y figurent pas) »).
- Le nom de la couche dans le sélecteur Leaflet : « Secteurs (ventes DVF) ». Les couches « Bientôt en vente ? » et « Annonces vues » restent.
- L'indicateur « médiane €/m² » de l'en-tête se calcule désormais sur ces ventes.

- [ ] **Step 1: Write the failing e2e test**

```js
test('carte en secteurs : Wambrechies', async () => {
  // Nouvelle recherche Wambrechies (59118), type maison, puis clic sur « Carte ».
  await page.waitForSelector('.imx-sector', { timeout: 60000 });
  assert.ok((await page.locator('.imx-sector').count()) >= 10);
  assert.ok((await page.locator('.imx-sector.is-moins, .imx-sector.is-plus').count()) >= 1);
  assert.ok((await page.locator('.imx-sector.is-peu').count()) >= 1);
  const legend = await page.textContent('#side');
  for (const t of ['moins cher', 'dans la moyenne', 'plus cher']) assert.match(legend, new RegExp(t));
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:e2e`
Expected: FAIL (aucun `.imx-sector`)

- [ ] **Step 3: Implement**

Hachures des secteurs « peu » par un motif SVG ou une opacité réduite avec bord en pointillés ; couleurs lisibles sur le fond IGN. Retirer `loadMarket` et l'import de `dvfStats`, `priceBreaks`, `priceClass`, `marketOf` de `dashboard.js` (les fonctions restent dans `zone-data.js`, utilisées par leurs tests).

- [ ] **Step 4: Run to verify it passes**

Run: `npm test && npm run test:e2e`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/dashboard/sector-layer.js src/dashboard/dashboard.js src/dashboard/dashboard.html tests/e2e/extension.e2e.mjs
git commit -m "Carte en secteurs de 400 m : 3 niveaux de prix et nombre de ventes"
```

---

### Task 7: Ventes passées et fourchette des ventes proches

**Files:**
- Create: `src/dashboard/sales-view.js`
- Modify: `src/dashboard/feed.js` (ligne « Ventes proches » d'une annonce), `src/dashboard/dashboard.js` (aiguillage de la vue)
- Test: `tests/e2e/extension.e2e.mjs` (prolonger le test Wambrechies)

**Interfaces:**
- Consumes: `loadSearchSales` (tâche 6), `nearestSales` et `isComparable` (tâche 3).
- Produces:
  - `renderSalesView({ search, token, isCurrent, body, focusSale }) -> Promise<void>`.
  - Tableau `.imx-sales-table`, colonnes dans l'ordre : Date, Rue, Prix, Surface, €/m², Terrain, Dépendance. La colonne Dépendance affiche « oui » ou rien, jamais « non » ; l'en-tête porte une infobulle « Garage, cave ou abri vendu avec le bien. Un garage intégré à la maison n'apparaît souvent pas. ».
  - Tri par date décroissante, 50 lignes puis « Afficher 50 de plus » ; interrupteur « Comparables à ma recherche seulement » (via `isComparable`), avec le nombre de comparables sur le total.
  - En tête de vue : nombre de ventes, médiane par commune, « Ventes connues jusqu'au <date> ».
  - Dans le Fil, pour une annonce placée sur la carte (adresse géocodée) : ligne « Ventes proches : 3 100 à 3 600 €/m² (15 ventes dans un rayon de 130 m) » à partir de `nearestSales`, avec le nombre de ventes comparables parmi les 15.

- [ ] **Step 1: Extend the e2e test first**

Dans « carte en secteurs : Wambrechies » : cliquer « Ventes passées », attendre `.imx-sales-table tbody tr` (au moins 20 lignes), vérifier que l'en-tête contient « €/m² », « Terrain », « Dépendance » et que la page contient « Ventes connues jusqu'au ».

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:e2e`
Expected: FAIL (aucune `.imx-sales-table`)

- [ ] **Step 3: Implement**

- [ ] **Step 4: Run to verify it passes**

Run: `npm test && npm run test:e2e`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/dashboard/sales-view.js src/dashboard/feed.js src/dashboard/dashboard.js tests/e2e/extension.e2e.mjs
git commit -m "Ventes passées : prix au m², terrain et dépendance ; fourchette des 15 ventes les plus proches"
```

---

### Task 8: Version 0.11.0, documentation, mise en ligne

**Files:**
- Modify: `manifest.json`, `package.json` (version `0.11.0`), `README.md` (tableau de bord devenu « Mes recherches », secteurs, ventes passées, architecture : `sales.js`, `sectors.js`, fichiers du tableau de bord)

- [ ] **Step 1: Bump versions and update the README**

- [ ] **Step 2: Full verification**

Run: `npm test && npm run test:e2e && node scripts/build-web.mjs`
Expected: tous les tests PASS ; `dist-web/src/common/sales.js`, `dist-web/src/common/sectors.js` et `dist-web/src/dashboard/feed.js` présents.

- [ ] **Step 3: Commit and push**

```bash
git add manifest.json package.json README.md
git commit -m "Version 0.11.0 : Mes recherches, carte en secteurs, ventes passées"
git push
```

- [ ] **Step 4: Live check**

Après le déploiement Vercel : `https://immodex.vercel.app/src/dashboard/dashboard.html` répond avec la méta `immodex-version` à `0.11.0` ; dans WebKit à la taille d'un iPhone 13 (Playwright `devices['iPhone 13']`), une recherche Wambrechies affiche la vue Carte avec des `.imx-sector`. Nathan recharge l'extension dans `chrome://extensions`.
