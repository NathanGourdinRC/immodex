# Lot 4 : classe énergie, délai de vente et lien annonce-vente · plan de construction

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Relier les ventes DVF aux diagnostics énergie (DPE) par l'adresse pour donner, dès maintenant, le prix au m² par classe énergie et le délai entre le DPE et la vente dans chaque commune suivie ; relier les annonces retirées par le robot à leur vente DVF quand elle paraît, pour mesurer la marge de négociation réelle.

**Architecture:** Le croisement DPE ↔ DVF est fait côté serveur dans `api/dvf.js` (réponse en cache une semaine) : chaque vente reçoit sa classe énergie et le délai depuis son DPE, et la réponse porte les statistiques de la commune. Le lien annonce ↔ vente est une étape mensuelle du robot (`api/_lib/sale-link.js`), qui pose `sale` sur l'annonce retirée. L'appli affiche ces données dans « Ventes passées » et dans le Fil.

**Tech Stack:** Fonctions Vercel (Node ESM), API DPE de l'ADEME (data-fair, pagination `next`), fichiers geo-dvf, `node --test`, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-02-recherches-scan-ventes-design.md` §7.5 et §7.6. Mesure du 3 novembre 2026 sur Wambrechies : 328 ventes de maisons sur 538 reliées à un DPE antérieur, délai médian 161 jours (125 à 232), prix médian C 3 896, D 3 503, E 3 124, F 2 825, G 2 386 €/m².

## Global Constraints

- DPE pris dans le jeu « dpe03existant » (depuis juillet 2021) ; au plus 5 pages de 1 000 lignes par commune et par type ; seuls les champs utiles sont demandés.
- Lien vente ↔ DPE : même numéro et même suffixe, même rue (`sameStreet`), DPE établi au plus 730 jours avant la vente, surface habitable à 15 % près quand les deux sont connues ; le plus récent des DPE qui conviennent.
- Statistiques affichées seulement à partir de 5 ventes par classe ; délai affiché à partir de 10 ventes reliées.
- Lien annonce ↔ vente (spec §7.5) : sûr si l'adresse probable de l'annonce (DPE) désigne la même adresse que la vente ; probable si même type, surface à 5 % près, terrain à 15 % près quand connu, vente entre 1 et 12 mois après le retrait ; jamais présenté comme certain s'il est probable. Vérifié au plus une fois par mois et par commune.
- Aucune donnée personnelle ; noindex inchangé ; interface en français, sans tiret cadratin ; commits à chemins explicites avec la ligne `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. Deux logements à la même adresse (maisons jumelles, division) : la surface départage, sinon pas de lien. Test tâche 1.
2. DPE refait après la vente (nouveau propriétaire) : jamais relié à la vente précédente (DPE postérieur exclu). Test tâche 1.
3. ADEME injoignable : `api/dvf` répond quand même avec les ventes, sans classes ni statistiques, et ne met pas en cache une réponse incomplète plus d'une heure. Test tâche 2.
4. Annonce retirée sans vente trouvée : rien n'est affiché, aucune marge inventée. Test tâche 4.
5. Commune sans DPE (ou classe rare) : pas de ligne de statistique trompeuse sous 5 ventes. Test tâche 1.

---

### Task 1: Lien vente ↔ DPE et statistiques (pur)

**Files:** Create `src/common/dpe-link.js` ; Test `tests/dpe-link.test.mjs`

**Interfaces:**
- Produces: `linkSalesToDpe(sales, dpeRecords, { maxDays = 730, surfaceTolerance = 0.15 }) -> Map<saleId, { energyClass, dpeDate, days }>` ; `energyStats(sales, links) -> { byClass: { [classe]: { count, median } }, delay: { count, median, p25, p75 } | null }` (classes de moins de 5 ventes et délai de moins de 10 ventes absents).
- [ ] Tests : lien simple ; maisons jumelles départagées par la surface ; DPE postérieur exclu ; DPE de plus de 2 ans exclu ; statistiques et seuils. FAIL, implémenter, PASS, commit.

### Task 2: Ventes avec classe énergie dans `api/dvf.js`

**Files:** Create `api/_lib/dpe-commune.js` ; Modify `api/dvf.js` ; Test `tests/dvf-api.test.mjs`

**Interfaces:**
- Consumes: Task 1.
- Produces: `communeDpe(insee, type, { fetchImpl, maxPages = 5 }) -> Promise<record[] | null>` (`null` si l'ADEME est injoignable) ; réponse `GET /api/dvf` : chaque vente porte `energyClass`, `dpeDate`, `dpeDays` quand elle est reliée ; champ `energy: { byClass, delay } | null` ; `Cache-Control` d'une heure seulement si `energy` est `null`.
- [ ] Tests avec faux ADEME (deux pages, `next`) et faux geo-dvf ; ADEME en erreur. FAIL, implémenter, PASS, commit.

### Task 3: Affichage dans l'appli

**Files:** Modify `src/common/sales.js` (`createSearchSales` garde `energy` par commune), `src/dashboard/sales-view.js`, `src/dashboard/annonces.js`, `src/dashboard/feed.js`, `src/dashboard/dashboard.html` ; Test `tests/sales.test.mjs`, `tests/e2e/extension.e2e.mjs`

**Interfaces:**
- Produces: `searchSales(...)` renvoie aussi `energy: { [insee]: { byClass, delay } }`.
- Ventes passées : colonne « DPE » (lettre colorée) ; au-dessus du tableau, « Délai médian entre le DPE et la vente : 5 mois (4 à 8 mois), 328 ventes » et un tableau « Prix au m² selon la classe énergie ».
- Fil (annonces du robot et annonces vues) : si la classe énergie du bien est connue et que sa commune a la statistique, ligne « Classe D à Wambrechies : 3 503 €/m² médian (139 ventes) ».
- [ ] e2e : `api/dvf` servi par Playwright avec ventes et `energy` ; la vue Ventes passées montre « Délai médian » et une colonne « DPE » ; une annonce de classe D montre « Classe D à Wambrechies ». FAIL, implémenter, PASS, commit.

### Task 4: Lien annonce retirée ↔ vente DVF (robot)

**Files:** Create `api/_lib/sale-link.js` ; Modify `api/_lib/scan-run.js` ; Test `tests/sale-link.test.mjs`, `tests/scan-run.test.mjs`

**Interfaces:**
- Produces: `matchSale(listing, sales) -> { date, price, pricePerM2, how: 'sure' | 'probable' } | null` ; dans `runScan`, étape mensuelle par commune (`meta._sales.lastCheck`) pour les annonces retirées sans `sale`, avec `loadSales(insee, type)` injectable (par défaut `handleDvf`).
- [ ] Tests : lien sûr par adresse ; lien probable ; vente avant le retrait ou plus de 12 mois après : rien ; une seule vérification par mois. FAIL, implémenter, PASS, commit.

### Task 5: Marge de négociation dans le Fil

**Files:** Modify `src/common/listings.js` (`negotiation(groups) -> { count, median, sure } | null`, à partir de 3 liens), `src/dashboard/annonces.js` ; Test `tests/listings.test.mjs`, e2e.

- Annonce retirée et vendue : « Vendue 455 000 € le 12/03/2027, 7 % sous le premier prix affiché (lien probable) ».
- En tête du Fil : « Marge de négociation constatée : 6 % (12 ventes reliées) » à partir de 3 liens.
- [ ] Tests, FAIL, implémenter, PASS, commit.

### Task 6: Version 0.13.0, mise en ligne, vérification

- [ ] README, version, `npm test && npm run test:e2e`, relecture finale, push ; vérifier `GET /api/dvf?insee=59636&type=maison` en ligne (classes, délai) et la vue Ventes passées sur iPhone (WebKit).
