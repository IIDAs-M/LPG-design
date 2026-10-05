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

test('表にない条件は安全側の値で代用し、推奨が代用値なら警告', () => {
  // 自動切替式・ろ号PP60・−5℃ は表Ⅱ－4－1 にない → 単段(表Ⅱ－4－2)のろ号 −5℃ 1時間 0.50
  const r = calculate(input({ gas: 'ro60', tempC: -5 }));
  const c = opt(r, 50);
  assert.equal(c.substitute, true);
  assert.equal(c.generationKgh, 0.50);
  assert.equal(r.recommendedId, 'c50');
  assert.ok(r.warnings.some(w => w.includes('代用値')));
});

test('推奨以外の容器にも数値が出る（自動切替式の20kg・10kg）', () => {
  const r = calculate(input({ perUnit: 1.2 * 2 * 14, units: 6, simultaneityPct: 50, peak: '1.5' }));
  assert.equal(r.recommendedId, 'c50');
  assert.equal(opt(r, 50).substitute, false);
  for (const size of [30, 20]) {
    const o = opt(r, size);
    assert.equal(o.available, true);
    assert.equal(o.substitute, true);
    assert.ok(o.total > 0);
    // 代用値は表どおりの自動切替式の値より小さい（安全側）
    assert.ok(o.generationKgh < opt(r, 50).generationKgh);
  }
  // 20kg: 設計基準にない → 早見表の連続使用 1.4（短いピークにも安全側）。30kg は 20kg の値で代用
  assert.equal(opt(r, 20).generationKgh, 1.4);
  assert.equal(opt(r, 20).quick, true);
  assert.equal(opt(r, 30).generationKgh, 1.4);
  assert.ok(opt(r, 30).basis.startsWith('20kg容器'));
});

test('代用できる値もない条件は推奨なしで警告', () => {
  const r = calculate(input({ gas: 'ro60', tempC: -10 }));
  assert.equal(r.recommendedId, null);
  assert.ok(r.options.every(o => !o.available));
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

test('自動切替式は 50・30・20kg、単段は 50・30・20・10kg を表示する', () => {
  const auto = calculate(input({ regulator: 'auto' }));
  assert.deepEqual(auto.options.map(o => o.sizeKg), [50, 30, 20]);
  const single = calculate(input({ regulator: 'single', gas: 'i80' }));
  assert.deepEqual(single.options.map(o => o.sizeKg), [50, 30, 20, 10]);
  // 単段・い号PP80・5℃・1時間: 30kg は 20kg の 1.35 で代用
  assert.equal(opt(single, 30).generationKgh, 1.35);
  assert.equal(opt(single, 30).substitute, true);
  assert.equal(opt(single, 20).substitute, false);
  // 30kg は容器が大きい分、貯蔵量が増える
  assert.equal(opt(single, 30).storedKg, opt(single, 30).total * 30);
});

test('容器サイズを指定すると、そのサイズで構成する', () => {
  const base = { perUnit: 1.2 * 2 * 14, units: 6, simultaneityPct: 50, peak: '1.5' };
  const auto = calculate(input(base));
  assert.equal(auto.recommendedId, 'c50');
  assert.equal(auto.preferredSize, null);
  const p20 = calculate(input(Object.assign({ preferredSize: 20 }, base)));
  assert.equal(p20.recommendedId, 'c20');
  assert.equal(p20.preferredSize, 20);
  assert.ok(p20.warnings.some(w => w.includes('指定した容器') && w.includes('代用値')));
  // 他のサイズも比較用に計算される
  assert.deepEqual(p20.options.map(o => o.sizeKg), [50, 30, 20]);
});

test('自動切替式で10kgを指定した場合は自動選定に戻して警告', () => {
  const r = calculate(input({ preferredSize: 10 }));
  assert.equal(r.preferredSize, null);
  assert.equal(r.recommendedId, 'c50');
  assert.ok(r.warnings.some(w => w.includes('10kg容器は自動切替式調整器では選べません')));
});

test('単段で10kgを指定できる、データがなければ推奨なし', () => {
  const ok = calculate(input({ regulator: 'single', gas: 'i80', preferredSize: 10 }));
  assert.equal(ok.recommendedId, 'c10');
  const ng = calculate(input({ regulator: 'single', gas: 'i80', tempC: -10, preferredSize: 10 }));
  assert.equal(ng.recommendedId, null);
  assert.ok(ng.warnings.some(w => w.includes('計算できません')));
});

test('業務用で50kg以外を指定すると注記', () => {
  const r = calculate(input({ usage: 'business', regulator: 'single', gas: 'i80', preferredSize: 20 }));
  assert.equal(r.recommendedId, 'c20');
  assert.ok(r.notes.some(n => n.includes('設置場所の制限')));
});

test('早見表は設計基準に値がない条件だけを補う', () => {
  const { lookupGenerationSafe: L } = require('../calc.js');
  // 設計基準にある値はそのまま（早見表の 3.0 ではなく表Ⅱ－4－1 の 2.50）
  const std = L('auto', 50, 'i95', 5, 'cont');
  assert.equal(std.value, 2.50);
  assert.equal(std.quick, false);
  // 自動切替式 20kg・連続使用・5℃ は設計基準にない → 早見表 1.4（代用ではない）
  const q = L('auto', 20, 'i95', 5, 'cont');
  assert.deepEqual([q.value, q.quick, q.substitute, q.source], [1.4, true, false, '早見表（目安）']);
  // 単段 50kg・1.5時間 は設計基準・早見表とも値がない → 早見表の2時間ピーク 4.2 で代用
  const p15 = L('single', 50, 'i95', 5, '1.5');
  assert.deepEqual([p15.value, p15.quick, p15.substitute], [4.2, true, true]);
  // 単段 10kg・い号PP95・1時間・0℃ → 早見表 連続 0.7 で代用
  assert.equal(L('single', 10, 'i95', 0, '1').value, 0.7);
  // 単段 50kg・−10℃ → 早見表 連続 1.2 で代用
  assert.equal(L('single', 50, 'i95', -10, '1').value, 1.2);
  // い号PP80 には早見表を使わない（従来どおり設計基準から安全側の値）
  const i80 = L('auto', 20, 'i80', 5, '1.5');
  assert.deepEqual([i80.value, i80.quick], [1.00, false]);
  // 30kg は 20kg の値（早見表を含む）で代用
  const c30 = L('auto', 30, 'i95', 5, 'cont');
  assert.deepEqual([c30.value, c30.substitute], [1.4, true]);
});

test('推奨は設計基準の値がある容器を優先する', () => {
  const r = calculate(input({ perUnit: 377.5 / 60, units: 60, peak: 'cont' }));
  assert.equal(r.recommendedId, 'c50');
  assert.equal(opt(r, 50).generationKgh, 2.50);
  assert.ok(r.notes.some(n => n.includes('早見表')));
});
