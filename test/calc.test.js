const test = require('node:test');
const assert = require('node:assert/strict');
const { calculate, lookupGeneration } = require('../calc.js');

function input(overrides) {
  return Object.assign({
    usage: 'residential',
    inputUnit: 'kw',
    perUnit: 10,
    units: 1,
    simultaneityPct: 100,
    kgPerM3: 2.0,
    regulator: 'auto',
    gas: 'i95',
    tempC: 5,
    peak: '1',
    series: 2,
    monitored: false,
    monthlyPerUnit: null,
    monthlyUnit: 'm3'
  }, overrides);
}
const opt = (r, size) => r.options.find(o => o.sizeKg === size);

// 参考資料 4.2.1 戸別供給方式の算定例: 59.7kW、50kg、5℃、い号PP95、1時間 → 0.78 → 1本、2系列で2本
test('算定例: 戸別供給方式', () => {
  const r = calculate(input({ perUnit: 59.7, monthlyPerUnit: 20, monthlyUnit: 'kg' }));
  assert.equal(r.supplyType.id, 'individual');
  const c = opt(r, 50);
  assert.equal(c.generationKgh, 5.50);
  assert.equal(c.nCalc.toFixed(2), '0.78');
  assert.equal(c.perSide, 1);
  assert.equal(c.total, 2);
  assert.equal(c.exchange.label, '2か月に1回');
});

// 4.2.2 小規模集団: 109.0kW、6戸、1.5時間 → 3.90kg/h、1.53 → 2本、4本設置、交換 月2回
test('算定例: 小規模集団供給方式', () => {
  const r = calculate(input({ perUnit: 109.0 / 6, units: 6, peak: '1.5', monthlyPerUnit: 20, monthlyUnit: 'kg' }));
  assert.equal(r.supplyType.id, 'small');
  const c = opt(r, 50);
  assert.equal(c.generationKgh, 3.90);
  assert.ok(Math.abs(c.nCalc - 1.53) < 0.01); // 資料は 1.537 を 1.53 と表記
  assert.equal(c.perSide, 2);
  assert.equal(c.total, 4);
  assert.equal(c.exchange.label, '月2回');
});

// 中規模集団: 377.5kW、60戸、連続使用 → 2.50kg/h、8.3 → 9本、18本設置、交換 月3回
test('算定例: 中規模集団供給方式', () => {
  const r = calculate(input({ perUnit: 377.5 / 60, units: 60, peak: 'cont', monthlyPerUnit: 20, monthlyUnit: 'kg' }));
  assert.equal(r.supplyType.id, 'medium');
  const c = opt(r, 50);
  assert.equal(c.generationKgh, 2.50);
  assert.equal(c.nCalc.toFixed(1), '8.3');
  assert.equal(c.perSide, 9);
  assert.equal(c.total, 18);
  assert.equal(c.exchange.label, '月3回');
});

// 設計例(液石法 69戸): 23.3kW×69戸×25% = 402kW → 8.9 → 9本、18本、調整器能力 28.7kg/h
test('設計例: 69戸・同時使用率25%', () => {
  const r = calculate(input({ perUnit: 23.3, units: 69, simultaneityPct: 25, peak: 'cont' }));
  assert.equal(r.peakKW.toFixed(1), '401.9');
  const c = opt(r, 50);
  assert.ok(Math.abs(c.nCalc - 8.9) < 0.1); // 資料は 8.84 を 8.9 と表記
  assert.equal(c.total, 18);
  assert.equal(r.regulatorCapacityKgh.toFixed(1), '28.7');
});

test('小規模集団の1系列は0.7を掛けない', () => {
  const r = calculate(input({ perUnit: 10, units: 5, series: 1 }));
  assert.equal(r.designKW.toFixed(2), (50 * 1.1).toFixed(2));
});

test('集中監視ありなら安全率1.0', () => {
  const r = calculate(input({ perUnit: 10, units: 5, monitored: true }));
  assert.equal(r.designKW.toFixed(2), (50 * 0.7).toFixed(2));
});

test('集団供給は単段を選んでも自動切替式で計算する', () => {
  const r = calculate(input({ units: 5, regulator: 'single' }));
  assert.equal(r.regulator, 'auto');
  assert.equal(r.spare, true);
});

test('戸別の単段調整器は予備側なし、20kg・10kgも計算できる', () => {
  const r = calculate(input({ regulator: 'single', gas: 'i80', perUnit: 14 }));
  assert.equal(r.spare, false);
  assert.equal(opt(r, 20).generationKgh, 1.35);
  assert.equal(opt(r, 20).total, 1);
  assert.equal(opt(r, 10).generationKgh, 0.70);
  assert.equal(opt(r, 10).total, 2);
});

test('m³/h 入力は換算係数と14で kW に換算する', () => {
  const r = calculate(input({ inputUnit: 'm3h', perUnit: 1.5, units: 1, kgPerM3: 2.0 }));
  assert.equal(r.peakKgh, 3.0);
  assert.equal(r.peakKW, 42);
});

test('表の参照', () => {
  assert.equal(lookupGeneration('auto', 50, 'ro60', -5, '1').value, null);
  assert.equal(lookupGeneration('auto', 50, 'i80', 0, '4').value, 1.50);
  assert.equal(lookupGeneration('single', 50, 'ro60', 0, '1').value, 1.15);
  assert.equal(lookupGeneration('auto', 50, 'i95', -15, '2').value, 1.00);
  assert.equal(lookupGeneration('auto', 50, 'i95', -15, '1.5').value, null);
  assert.equal(lookupGeneration('single', 50, 'i95', -10, '1').value, null);
  assert.equal(lookupGeneration('auto', 20, 'i95', -5, '0.5').value, 1.6);
  assert.equal(lookupGeneration('single', 10, 'i80', -15, '0.5').value, 0.1);
  assert.equal(lookupGeneration('auto', 20, 'i95', 5, '1').value, null);
});

test('データがない条件では推奨なしで警告', () => {
  const r = calculate(input({ gas: 'ro60', tempC: -5 }));
  assert.equal(r.recommendedId, null);
  assert.ok(r.warnings.length > 0);
});

test('業務用は50kgを推奨し、連続使用で強制気化の注意', () => {
  const r = calculate(input({ usage: 'business', regulator: 'single', gas: 'i80', peak: 'cont', perUnit: 5 }));
  assert.equal(r.recommendedId, 'c50');
  assert.ok(r.warnings.some(w => w.includes('強制気化')));
});

test('70戸以上は警告', () => {
  const r = calculate(input({ units: 70 }));
  assert.ok(r.warnings.some(w => w.includes('ガス事業法')));
});

test('入力エラー', () => {
  const r = calculate(input({ units: 0, simultaneityPct: 120, perUnit: -1 }));
  assert.equal(r.ok, false);
  assert.ok(r.errors.units && r.errors.simultaneityPct && r.errors.perUnit);
});

test('既定の換算は 1m³/h ＝ 2kg/h、変更すると結果に反映される', () => {
  const { DEFAULT_KG_PER_M3 } = require('../calc.js');
  assert.equal(DEFAULT_KG_PER_M3, 2);
  const r = calculate(input({ inputUnit: 'm3h', perUnit: 1, units: 1, kgPerM3: 2.5 }));
  assert.equal(r.peakKgh, 2.5);
  assert.equal(r.peakKW, 35);
});

test('1か月の消費量は m³/月 を既定とし、kg/月 も選べる', () => {
  const base = { perUnit: 377.5 / 60, units: 60, peak: 'cont' };
  const m3 = calculate(input(Object.assign({ monthlyPerUnit: 10 }, base)));
  const kg = calculate(input(Object.assign({ monthlyPerUnit: 20, monthlyUnit: 'kg' }, base)));
  assert.equal(m3.monthlyKgPerUnit, 20);
  assert.equal(m3.monthlyTotalKg, 1200);
  assert.equal(opt(m3, 50).exchange.label, '月3回');
  assert.equal(opt(kg, 50).exchange.label, '月3回');
  const m3b = calculate(input(Object.assign({ monthlyPerUnit: 10, kgPerM3: 2.5 }, base)));
  assert.equal(m3b.monthlyKgPerUnit, 25);
});
