// Fonds de carte partagés par la carte des candidats et le tableau de bord.
// Géoplateforme de l'IGN (WMTS, sans clé) plutôt qu'OpenStreetMap : les serveurs
// d'OSM exigent un en-tête Referer des navigateurs, et une page d'extension
// (chrome-extension://…) n'en envoie jamais, d'où des tuiles « Access blocked ».
// À charger après leaflet.js.
(function () {
  'use strict';
  if (window.__immodexTiles) return;

  // Dernier fond choisi, commun aux deux pages (même origine chrome-extension://).
  const STORAGE_KEY = 'immodex-base-layer';

  // Requête GetTile en paramètres d'URL ; la grille PM est celle de Leaflet (z, x, y).
  function wmts(layer, format) {
    return (
      'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0' +
      `&LAYER=${layer}&STYLE=normal&TILEMATRIXSET=PM&FORMAT=${format}` +
      '&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}'
    );
  }

  // Zoom 0 à 19 pour les deux couches (GetCapabilities de data.geopf.fr).
  // Licence Ouverte Etalab 2.0 : la source « IGN » doit être citée.
  const BASES = [
    { name: 'Plan', layer: 'GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2', format: 'image/png', attribution: '&copy; IGN · Plan IGN' },
    { name: 'Photos aériennes', layer: 'ORTHOIMAGERY.ORTHOPHOTOS', format: 'image/jpeg', attribution: '&copy; IGN · photographies aériennes' },
  ];

  function savedName() {
    try {
      return localStorage.getItem(STORAGE_KEY);
    } catch {
      return null;
    }
  }

  // Ajoute à la carte le fond choisi la dernière fois (Plan sinon) et renvoie
  // { nom: couche } pour le sélecteur de L.control.layers.
  function addBaseLayers(map) {
    const layers = {};
    for (const b of BASES) layers[b.name] = L.tileLayer(wmts(b.layer, b.format), { maxZoom: 19, attribution: b.attribution });
    (layers[savedName()] || layers[BASES[0].name]).addTo(map);
    map.on('baselayerchange', (e) => {
      try {
        localStorage.setItem(STORAGE_KEY, e.name);
      } catch {
        // stockage indisponible : le choix ne sera pas retenu
      }
    });
    return layers;
  }

  window.__immodexTiles = { addBaseLayers };
})();
