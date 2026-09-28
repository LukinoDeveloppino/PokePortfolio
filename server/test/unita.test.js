// Test delle parti pure (nessun database, nessuna rete).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { convertiBlueprintInSet } from '../src/services/catalog.js';
import { prezzoMinimo } from '../src/services/prices.js';
import { formatDate } from '../src/lib/date.js';

const blueprint = (id, extra = {}) => ({
  id,
  name: `Carta ${id}`,
  category_id: 73,
  image_url: `https://img/${id}.jpg`,
  fixed_properties: { collector_number: String(id).padStart(3, '0'), pokemon_rarity: 'Rare' },
  editable_properties: [{ name: 'pokemon_language', default_value: 'en' }],
  ...extra
});

test('convertiBlueprintInSet: solo carte singole, id deterministici, logo da GitHub', () => {
  const { set, carte } = convertiBlueprintInSet(
    { id: 10, name: 'Base Set' },
    [blueprint(1), blueprint(2, { version: 'Holo | Shadowless' }), { id: 3, category_id: 99 }],
    { 'base set': { logo: 'https://logo', releaseDate: '1999-01-09' } }
  );
  assert.deepEqual(set, {
    id: 10, name: 'Base Set', series: 'INT', logo_url: 'https://logo',
    release_date: '1999-01-09', total_cards: 2
  });
  assert.equal(carte.length, 2);
  assert.equal(carte[0].id, '10_1');
  assert.equal(carte[0].number, '001');
  assert.equal(carte[1].rarity, 'Rare · Holo');
});

test('convertiBlueprintInSet: set giapponese senza logo, set senza carte singole', () => {
  const jp = convertiBlueprintInSet(
    { id: 20, name: 'Base Set' },
    [blueprint(1, { editable_properties: [{ name: 'pokemon_language', default_value: 'jp' }] })],
    { 'base set': { logo: 'https://logo', releaseDate: '1999-01-09' } }
  );
  assert.equal(jp.set.series, 'JP');
  assert.equal(jp.set.logo_url, null);

  assert.deepEqual(convertiBlueprintInSet({ id: 30, name: 'X' }, [{ id: 1, category_id: 99 }]),
                   { skip: 'nessuna carta singola' });
});

test('prezzoMinimo: filtra condizione e venditori in vacanza, ripiega su qualsiasi condizione', () => {
  const offerte = [
    { price: { cents: 500, currency: 'EUR' }, properties_hash: { condition: 'Near Mint' } },
    { price: { cents: 150, currency: 'EUR' }, properties_hash: { condition: 'Near Mint' }, on_vacation: true },
    { price: { cents: 300, currency: 'EUR' }, properties_hash: { condition: 'Slightly Played' } }
  ];
  assert.equal(prezzoMinimo(offerte, 'Near Mint').price, 5);
  assert.equal(prezzoMinimo(offerte, 'Lightly Played').price, 3);
  assert.equal(prezzoMinimo(offerte, 'Damaged').price, 3);
  assert.equal(prezzoMinimo([], 'Near Mint').price, null);
});

test('formatDate: formato della versione GAS nel fuso configurato', () => {
  assert.equal(formatDate(new Date('2026-07-01T01:00:00Z')), '2026-07-01 03:00:00');
  assert.equal(formatDate(null), '');
});
