const test = require('node:test');
const assert = require('node:assert/strict');
const { calculate, DEFAULT_COEFFICIENTS } = require('../calc.js');

function input(overrides) {
  return Object.assign({
    perUnitM3h: 1.0,
    units: 10,
    simultaneityPct: 50,
    kgPerM3: 2.0,
    spare: true,
    cylinders: [
      { id: 'c20', name: '20kg容器', capacityKg: 20, generationKgh: 0.5, enabled: true },
      { id: 'c50', name: '50kg容器', capacityKg: 50, generationKgh: 1.0, enabled: true }
    ]
  }, overrides);
}

test('必要ガス量を算出する', () => {
  const r = calculate(input());
  assert.equal(r.ok, true);
  assert.equal(r.totalM3h, 10);
  assert.equal(r.peakM3h, 5);
  assert.equal(r.peakKgh, 10);
});

test('容器本数は切り上げ、予備側で2倍になる', () => {
  const r = calculate(input());
  const c50 = r.options.find(o => o.id === 'c50');
  const c20 = r.options.find(o => o.id === 'c20');
  assert.equal(c50.perSide, 10);
  assert.equal(c50.total, 20);
  assert.equal(c20.perSide, 20);
  assert.equal(r.recommendedId, 'c50');
});

test('予備側なしなら使用側本数のみ', () => {
  const r = calculate(input({ spare: false }));
  assert.equal(r.options.find(o => o.id === 'c50').total, 10);
});

test('端数は切り上げ、浮動小数誤差では切り上げない', () => {
  const r1 = calculate(input({ perUnitM3h: 1.01 }));
  assert.equal(r1.options.find(o => o.id === 'c50').perSide, 11);
  // 0.1 * 3 = 0.30000000000000004 でも 0.3 kg/h 容器1本
  const r2 = calculate(input({
    perUnitM3h: 0.1, units: 3, simultaneityPct: 50, kgPerM3: 2.0,
    cylinders: [{ id: 'x', name: 'x', capacityKg: 10, generationKgh: 0.3, enabled: true }]
  }));
  assert.equal(r2.options[0].perSide, 1);
});

test('最低1本は必要', () => {
  const r = calculate(input({ perUnitM3h: 0.01, units: 1, simultaneityPct: 1 }));
  assert.ok(r.options.every(o => o.perSide >= 1));
});

test('無効な容器は計算対象外', () => {
  const cyl = input().cylinders.map(c => Object.assign({}, c, { enabled: c.id === 'c20' }));
  const r = calculate(input({ cylinders: cyl }));
  assert.deepEqual(r.options.map(o => o.id), ['c20']);
});

test('入力エラーを返す', () => {
  const r = calculate(input({ units: 0, simultaneityPct: 120, perUnitM3h: -1 }));
  assert.equal(r.ok, false);
  assert.ok(r.errors.units);
  assert.ok(r.errors.simultaneityPct);
  assert.ok(r.errors.perUnitM3h);
});

test('既定の係数で計算できる', () => {
  const r = calculate(Object.assign({ perUnitM3h: 1.2, units: 20, simultaneityPct: 40, spare: true }, DEFAULT_COEFFICIENTS));
  assert.equal(r.ok, true);
  assert.ok(r.options.length === 4);
});
