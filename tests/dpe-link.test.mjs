import { test } from 'node:test';
import assert from 'node:assert/strict';
import { linkSalesToDpe, energyStats } from '../src/common/dpe-link.js';

const sale = (id, date, address, surface, pricePerM2 = 3000) => ({ id, date, address, surface, pricePerM2 });
const dpe = (id, date, address, surface, energyClass) => ({ id, date, address: `${address} 59118 Wambrechies`, surface, energyClass });

test('vente reliée au DPE établi avant elle à la même adresse', () => {
  const links = linkSalesToDpe([sale('v1', '2024-05-01', '12 RUE DE QUESNOY', 100)], [dpe('d1', '2024-01-10', '12 Rue de Quesnoy', 98, 'D')]);
  assert.deepEqual(links.get('v1'), { energyClass: 'D', dpeDate: '2024-01-10', days: 112 });
});

test('maisons jumelles à la même adresse : la surface départage', () => {
  const links = linkSalesToDpe([sale('v1', '2024-05-01', '7 RUE DES PIQURIERES', 118)], [dpe('d1', '2024-01-10', '7 Rue des Piqurières', 80, 'E'), dpe('d2', '2024-02-10', '7 Rue des Piqurières', 120, 'C')]);
  assert.equal(links.get('v1').energyClass, 'C');
});

test('DPE postérieur à la vente, trop ancien ou d’une autre surface : pas de lien', () => {
  const sales = [sale('v1', '2024-05-01', '3 RUE DE MARQUETTE', 100)];
  assert.equal(linkSalesToDpe(sales, [dpe('d1', '2024-06-01', '3 Rue de Marquette', 100, 'D')]).size, 0);
  assert.equal(linkSalesToDpe(sales, [dpe('d1', '2022-01-01', '3 Rue de Marquette', 100, 'D')]).size, 0);
  assert.equal(linkSalesToDpe(sales, [dpe('d1', '2024-01-01', '3 Rue de Marquette', 140, 'D')]).size, 0);
  assert.equal(linkSalesToDpe(sales, [dpe('d1', '2024-01-01', '3 bis Rue de Marquette', 100, 'D')]).size, 0);
});

test('le plus récent des DPE qui conviennent', () => {
  const links = linkSalesToDpe([sale('v1', '2024-05-01', '12 RUE DE QUESNOY', 100)], [dpe('d1', '2022-09-01', '12 Rue de Quesnoy', 100, 'F'), dpe('d2', '2024-02-01', '12 Rue de Quesnoy', 100, 'D')]);
  assert.equal(links.get('v1').energyClass, 'D');
});

test('statistiques : classes de 5 ventes au moins, délai à partir de 10 ventes reliées', () => {
  const sales = [];
  const dpes = [];
  for (let i = 0; i < 12; i++) {
    const cls = i < 6 ? 'C' : i < 10 ? 'D' : 'G';
    sales.push(sale(`v${i}`, '2024-06-01', `${i + 1} RUE DE QUESNOY`, 100, cls === 'C' ? 3900 + i : 3500));
    dpes.push(dpe(`d${i}`, '2024-01-01', `${i + 1} Rue de Quesnoy`, 100, cls));
  }
  const stats = energyStats(sales, linkSalesToDpe(sales, dpes));
  assert.deepEqual(Object.keys(stats.byClass), ['C']);
  assert.equal(stats.byClass.C.count, 6);
  assert.equal(stats.delay.count, 12);
  assert.equal(stats.delay.median, 152);
  const few = energyStats(sales.slice(0, 4), linkSalesToDpe(sales.slice(0, 4), dpes));
  assert.deepEqual(few, { byClass: {}, delay: null });
});
