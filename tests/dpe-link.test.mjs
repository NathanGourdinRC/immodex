import { test } from 'node:test';
import assert from 'node:assert/strict';
import { linkSalesToDpe, energyStats } from '../src/common/dpe-link.js';

const sale = (id, date, address, surface, pricePerM2 = 3000, type = 'Maison') => ({ id, date, address, surface, pricePerM2, type });
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

test('maison diagnostiquée deux fois : le plus récent des DPE compte', () => {
  const links = linkSalesToDpe([sale('v1', '2024-05-01', '12 RUE DE QUESNOY', 100)], [dpe('d1', '2022-09-01', '12 Rue de Quesnoy', 100, 'F'), dpe('d2', '2024-02-01', '12 Rue de Quesnoy', 102, 'D')]);
  assert.equal(links.get('v1').energyClass, 'D');
});

test('appartements d’un même immeuble que la surface ne sépare pas : pas de lien', () => {
  const flat = [sale('v1', '2024-05-01', '26 AVENUE DU PARC', 22, 4000, 'Appartement')];
  const two = (a, b) => [dpe('d1', '2023-10-01', '26 Avenue du Parc', 22, a), dpe('d2', '2024-01-01', '26 Avenue du Parc', 22.5, b)];
  assert.equal(linkSalesToDpe(flat, two('E', 'G')).size, 0);
  // Même classe pour tous les candidats : le lien ne dépend pas du logement choisi.
  assert.equal(linkSalesToDpe(flat, two('E', 'E')).get('v1').energyClass, 'E');
  // Un seul candidat à 5 % près de la surface vendue : c'est lui.
  const near = [dpe('d1', '2023-10-01', '26 Avenue du Parc', 50, 'C'), dpe('d2', '2024-01-01', '26 Avenue du Parc', 45, 'E')];
  assert.equal(linkSalesToDpe([sale('v2', '2024-05-01', '26 AVENUE DU PARC', 50, 4000, 'Appartement')], near).get('v2').energyClass, 'C');
});

test('statistiques : classes de 10 ventes au moins avec leur moitié centrale, délai à partir de 10 ventes reliées', () => {
  const sales = [];
  const dpes = [];
  const add = (i, cls, ppm) => {
    sales.push(sale(`v${i}`, '2024-06-01', `${i + 1} RUE DE QUESNOY`, 100, ppm));
    dpes.push(dpe(`d${i}`, '2024-01-01', `${i + 1} Rue de Quesnoy`, 100, cls));
  };
  for (let i = 0; i < 25; i++) add(i, i < 12 ? 'C' : i < 22 ? 'D' : 'G', i < 12 ? 3900 + i : i < 22 ? 3500 : 2000);
  const stats = energyStats(sales, linkSalesToDpe(sales, dpes));
  assert.deepEqual(Object.keys(stats.byClass), ['C', 'D']);
  assert.equal(stats.byClass.C.count, 12);
  assert.deepEqual(stats.byClass.D, { count: 10, median: 3500, p25: 3500, p75: 3500 });
  assert.ok(stats.byClass.C.p25 <= stats.byClass.C.median && stats.byClass.C.median <= stats.byClass.C.p75);
  assert.equal(stats.delay.count, 25);
  assert.equal(stats.delay.median, 152);
  const few = energyStats(sales.slice(0, 4), linkSalesToDpe(sales.slice(0, 4), dpes));
  assert.deepEqual(few, { byClass: {}, delay: null });
});

test('classe énergie qui n’explique rien (meilleure classe moins chère) : prix par classe non affiché', () => {
  const sales = [];
  const dpes = [];
  for (let i = 0; i < 22; i++) {
    sales.push(sale(`v${i}`, '2024-06-01', `${i + 1} RUE DE QUESNOY`, 100, i < 12 ? 3500 : 3900));
    dpes.push(dpe(`d${i}`, '2024-01-01', `${i + 1} Rue de Quesnoy`, 100, i < 12 ? 'C' : 'D'));
  }
  const stats = energyStats(sales, linkSalesToDpe(sales, dpes));
  assert.deepEqual(stats.byClass, {});
  assert.equal(stats.delay.count, 22);
});
