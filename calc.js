/*
 * LPガス 容器設置本数計算ロジック（自然気化方式）
 *
 * 出典: 参考資料「第4章 容器本数の決定及び貯蔵設備の位置・広さ」
 *   4.1 標準のガス発生能力（表Ⅱ－4－1、表Ⅱ－4－2、寒冷地・短時間消費の参考表）
 *   4.2 容器本数の決定（戸別・集団・業務用の算定式）
 *
 * 計算の流れ
 *   1. 最大ガス消費量   Q [kW] = 1件あたりの消費量 × 件数 × 同時使用率
 *                       （m³/h で入力した場合は m³/h × 2[kg/h per m³/h] × 14 で kW に換算。2 は既定値で変更可）
 *   2. 容器本数(計算値) N = Q × 系列係数 × 安全率 / (V × 14)
 *        戸別・業務用          : 系列係数 1.0、安全率 1.0
 *        小規模集団(2〜10戸)   : 1系列 → 1.0 × 1.1、2系列 → 0.7 × 1.1
 *        中規模集団(11〜69戸)  : 2系列 → 0.7 × 1.1
 *        集中監視システムで残量管理する場合は安全率 1.1 を 1.0 にできる
 *   3. 使用側本数       ceil(N)（最低1本）
 *   4. 設置本数         自動切替式調整器を使う場合は予備側を考慮して2倍
 *
 *   V: 標準のガス発生能力 [kg/h・本]、14: 1kg/h あたりの kW
 *
 * ブラウザでは window.LPGCalc、Node.js では module.exports として使える。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.LPGCalc = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var KW_PER_KGH = 14;

  // LPガスの換算 1m³/h ＝ 2kg/h（既定値）。画面上で変更できる。
  var DEFAULT_KG_PER_M3 = 2.0;

  var GASES = [
    { id: 'i95', name: 'い号ガス（PP95%以上）' },
    { id: 'i80', name: 'い号ガス（PP80%以上）' },
    { id: 'ro70', name: 'ろ号ガス（PP70%以上）' },
    { id: 'ro60', name: 'ろ号ガス（PP60%以上）' }
  ];
  var TEMPS = [5, 0, -5, -10, -15, -20];
  var PEAKS = [
    { id: '0.5', name: '30分（短時間消費・参考値）' },
    { id: '1', name: '1時間' },
    { id: '1.5', name: '1.5時間' },
    { id: '2', name: '2時間' },
    { id: '3', name: '3時間' },
    { id: '4', name: '4時間' },
    { id: 'cont', name: '連続使用（5時間以上）' }
  ];
  var SIZES = [50, 30, 20, 10];
  // 自動切替式調整器で表示する容器（10kg容器は表示しない）
  var AUTO_SIZES = [50, 30, 20];
  // 参考資料に表がない容器は、より小さい容器の値で代用する（容器が小さいほど発生能力は小さい＝安全側）
  var SIZE_SUBSTITUTE = { 30: 20 };

  // 値の並びは気温 [5, 0, -5] ℃。null はデータなし（表中の「－」）。
  var TABLES = {
    // 表Ⅱ－4－1 自動切替式調整器を使用した場合の50kg容器1本当たりの標準のガス発生能力
    auto: {
      50: {
        i95: { '1': [5.50, 4.40, 3.40], '1.5': [3.90, 3.17, 2.50], '2': [3.60, 2.90, 2.30], '3': [3.00, 2.40, 1.90], '4': [2.60, 2.20, 1.80], cont: [2.50, 2.00, 1.60] },
        i80: { '1': [4.20, 3.20, 2.10], '1.5': [3.03, 2.37, 1.63], '2': [2.70, 2.10, 1.40], '3': [2.20, 1.70, 1.20], '4': [1.90, 1.50, 1.10], cont: [1.80, 1.40, 1.05] },
        ro70: { '1': [3.10, 2.10, 1.05], '1.5': [2.30, 1.63, 0.93], '2': [2.00, 1.40, 0.80], '3': [1.70, 1.20, 0.72], '4': [1.50, 1.10, 0.70], cont: [1.40, 1.00, 0.60] },
        ro60: { '1': [2.30, 1.40, null], '1.5': [1.77, 1.17, null], '2': [1.50, 1.00, null], '3': [1.30, 0.90, null], '4': [1.20, 0.80, null], cont: [1.15, 0.70, null] }
      }
    },
    // 表Ⅱ－4－2 気温5℃・0℃・－5℃、残液30%のときの単段調整器による標準のガス発生能力
    // ろ号ガスは1行のみのため ro70・ro60 とも同じ値を使う。
    single: {
      50: {
        i95: { '1': [3.90, 3.30, 2.60], '2': [2.50, 2.10, 1.70], '3': [2.10, 1.70, 1.40], '4': [1.80, 1.50, 1.30], cont: [1.70, 1.40, 1.20] },
        i80: { '1': [3.20, 2.50, 1.85], '1.5': [2.35, 1.85, 1.35], '2': [1.80, 1.14, 1.00], '3': [1.50, 1.10, 0.80], '4': [1.30, 1.00, 0.80], cont: [1.20, 0.95, 0.70] },
        ro: { '1': [1.70, 1.15, 0.50], '1.5': [1.25, 0.85, 0.35], cont: [0.75, 0.45, 0.20] }
      },
      20: {
        i95: { cont: [0.60, 0.45, 0.35] },
        i80: { '1': [1.35, 1.05, 0.80], '1.5': [1.00, 0.80, 0.60], cont: [0.35, 0.25, 0.10] },
        ro: { '1': [0.75, 0.50, 0.25], '1.5': [0.55, 0.35, 0.20] }
      },
      10: {
        i80: { '1': [0.70, 0.55, 0.40], '1.5': [0.55, 0.40, 0.30], cont: [0.35, 0.30, 0.20] },
        ro: { '1': [0.40, 0.25, 0.15], '1.5': [0.30, 0.20, 0.10], cont: [0.20, 0.15, 0.05] }
      }
    },
    // (参考) 50kg容器における寒冷地のピーク時間別ガス発生能力（自動切替式）気温 [-10, -15, -20] ℃
    cold: {
      i95: { '1': [2.90, 1.40, 0.40], '2': [1.90, 1.00, 0.40], '3': [1.50, 0.90, 0.40], '4': [1.30, 0.80, 0.40], cont: [1.20, 0.80, 0.40] },
      i80: { '1': [1.00, 0.30, null], '2': [0.80, 0.30, null], '3': [0.70, 0.30, null], '4': [0.70, 0.30, null], cont: [0.60, 0.30, null] }
    },
    // (参考) 容器1本当たりのガス発生能力計算値 短時間(30分)消費  気温 [5, 0, -5, -10, -15, -20] ℃
    // i95 = PP95%以上、i80 = PP80〜95%未満
    short: {
      single: {
        50: { i95: [4.4, 3.7, 3.0, 2.4, 1.7, 1.0], i80: [3.2, 2.5, 1.8, 1.1, 0.5, null] },
        20: { i95: [1.8, 1.5, 1.2, 1.0, 0.7, 0.4], i80: [1.3, 1.0, 0.8, 0.5, 0.2, null] },
        10: { i95: [0.9, 0.8, 0.7, 0.5, 0.4, 0.2], i80: [0.7, 0.5, 0.4, 0.3, 0.1, null] }
      },
      auto: {
        50: { i95: [6.1, 5.0, 4.0, 3.0, 2.0, 1.0], i80: [4.7, 3.7, 2.6, 1.6, 0.6, null] },
        20: { i95: [2.5, 2.1, 1.6, 1.2, 0.8, 0.4], i80: [2.0, 1.5, 1.1, 0.7, 0.2, null] },
        10: { i95: [1.3, 1.1, 0.9, 0.6, 0.4, 0.2], i80: [1.0, 0.8, 0.6, 0.3, 0.1, null] }
      }
    }
  };

  /*
   * 標準のガス発生能力を表から引く。
   * 戻り値: { value: number|null, source: string }
   */
  function lookupGeneration(regulator, sizeKg, gas, tempC, peak) {
    var ti;
    if (peak === '0.5') {
      ti = [5, 0, -5, -10, -15, -20].indexOf(tempC);
      var s = TABLES.short[regulator] && TABLES.short[regulator][sizeKg];
      var row = s && s[gas];
      return { value: row && ti >= 0 ? row[ti] : null, source: '参考表（短時間30分消費）' };
    }
    if (tempC <= -10) {
      ti = [-10, -15, -20].indexOf(tempC);
      var c = regulator === 'auto' && sizeKg === 50 ? TABLES.cold[gas] : null;
      var cv = c && c[peak];
      return { value: cv && ti >= 0 ? cv[ti] : null, source: '参考表（寒冷地・自動切替式）' };
    }
    ti = [5, 0, -5].indexOf(tempC);
    var table, source;
    if (regulator === 'auto') {
      table = TABLES.auto[sizeKg];
      source = '表Ⅱ－4－1';
    } else {
      table = TABLES.single[sizeKg];
      source = '表Ⅱ－4－2';
      if (gas === 'ro70' || gas === 'ro60') gas = 'ro';
    }
    var g = table && table[gas];
    var v = g && g[peak];
    return { value: v && ti >= 0 ? v[ti] : null, source: source };
  }

  var GAS_ORDER = ['i95', 'i80', 'ro70', 'ro60'];
  var PEAK_ORDER = ['0.5', '1', '1.5', '2', '3', '4', 'cont'];
  function peakName(id) { return PEAKS.filter(function (p) { return p.id === id; })[0].name.replace(/（.*）/, ''); }
  function gasName(id) { return GASES.filter(function (g) { return g.id === id; })[0].name; }

  /*
   * 追加資料「LPガス 発生能力早見表」（プロパン・い号、残液約30%を想定した目安値）
   * 設計基準の表に値がない条件を補うためだけに使う。
   *   cont : 容器サイズ別 連続自然気化能力 気温 [20, 15, 10, 5, 0, -5, -10] ℃
   *   peak50 : 50kg容器 ピーク時発生能力 気温 [5, 0, -5] ℃（1時間ピークは「4.8 - 5.0」等の幅の下限値）
   */
  var QUICK = {
    temps: [20, 15, 10, 5, 0, -5, -10],
    cont: {
      10: [1.5, 1.3, 1.1, 0.9, 0.7, 0.5, 0.3],
      20: [2.3, 2.0, 1.7, 1.4, 1.1, 0.8, 0.5],
      50: [4.7, 4.2, 3.6, 3.0, 2.3, 1.7, 1.2]
    },
    peak50Temps: [5, 0, -5],
    peak50: {
      '1': [4.8, 3.8, 2.8],
      '2': [4.2, 3.2, 2.4],
      cont: [3.0, 2.3, 1.7]
    }
  };
  var QUICK_SOURCE = '早見表（目安）';

  // 早見表から引く。対象はい号ガス（PP95%以上）のみ。
  function lookupQuick(sizeKg, gas, tempC, peak) {
    if (gas !== 'i95') return null;
    if (sizeKg === 50 && QUICK.peak50[peak]) {
      var pi = QUICK.peak50Temps.indexOf(tempC);
      if (pi >= 0) return QUICK.peak50[peak][pi];
    }
    if (peak === 'cont' && QUICK.cont[sizeKg]) {
      var ti = QUICK.temps.indexOf(tempC);
      if (ti >= 0) return QUICK.cont[sizeKg][ti];
    }
    return null;
  }

  /*
   * ガス発生能力を決める。
   *   1. 設計基準の表（表Ⅱ－4－1、表Ⅱ－4－2、寒冷地・短時間の参考表）に該当条件の値があればそれを使う
   *   2. なければ早見表の同じ条件の値で補う（い号ガス PP95%以上のみ）
   *   3. それもなければ安全側（ガス発生能力が小さくなる側）の値で代用する（※）
   *      a. 早見表のより長いピーク時間（長いほど発生能力は小さい。連続使用の値は短いピークにも安全側）
   *      b. 設計基準の表で、自動切替式なら単段調整器 → より低い規格のガス → より長いピーク時間
   *   4. 表がない容器（30kg）→ より小さい容器（20kg）の値で 1〜3 を探す
   * 戻り値: { value, source, substitute: boolean, quick: boolean, basis: string }
   */
  function lookupGenerationSafe(regulator, sizeKg, gas, tempC, peak) {
    var regs = regulator === 'auto' ? ['auto', 'single'] : ['single'];
    var gases = GAS_ORDER.slice(GAS_ORDER.indexOf(gas));
    var peaks = PEAK_ORDER.slice(PEAK_ORDER.indexOf(peak));
    var sizes = SIZE_SUBSTITUTE[sizeKg] ? [sizeKg, SIZE_SUBSTITUTE[sizeKg]] : [sizeKg];

    function result(value, source, quick, parts) {
      return {
        value: value, source: source, quick: quick,
        substitute: parts.length > 0,
        basis: parts.length ? parts.join('・') + 'の値で代用' : ''
      };
    }

    for (var z = 0; z < sizes.length; z++) {
      var sizeParts = z > 0 ? [sizes[z] + 'kg容器'] : [];
      // 1. 設計基準の表
      var hit = lookupGeneration(regulator, sizes[z], gas, tempC, peak);
      if (hit.value !== null) return result(hit.value, hit.source, false, sizeParts);
      // 2・3a. 早見表（同じピーク時間 → より長いピーク時間）
      for (var q = 0; q < peaks.length; q++) {
        var qv = lookupQuick(sizes[z], gas, tempC, peaks[q]);
        if (qv === null) continue;
        return result(qv, QUICK_SOURCE, true, sizeParts.concat(q > 0 ? ['早見表のピーク時間' + peakName(peaks[q])] : []));
      }
      // 3b. 設計基準の表で安全側の値
      for (var r = 0; r < regs.length; r++) {
        for (var g = 0; g < gases.length; g++) {
          for (var p = 0; p < peaks.length; p++) {
            if (r === 0 && g === 0 && p === 0) continue;
            var sub = lookupGeneration(regs[r], sizes[z], gases[g], tempC, peaks[p]);
            if (sub.value === null) continue;
            var parts = sizeParts.slice();
            if (r > 0) parts.push('単段調整器');
            if (g > 0) parts.push(gasName(gases[g]));
            if (p > 0) parts.push('ピーク時間' + peakName(peaks[p]));
            return result(sub.value, sub.source, false, parts);
          }
        }
      }
    }
    return { value: null, source: '', substitute: false, quick: false, basis: '' };
  }

  // 浮動小数の誤差で 2.0000000001 → 3 にならないようにする
  var EPS = 1e-9;
  function ceilSafe(x) { return Math.ceil(x - EPS); }
  function isPositive(x) { return typeof x === 'number' && isFinite(x) && x > 0; }

  /*
   * 供給方式を判定する。
   *   戸別: 一般住宅で1件
   *   小規模集団: 2〜10戸（1系列 / 2系列を選べる）
   *   中規模集団: 11〜69戸（2系列）
   *   業務用: 業務用を選んだ場合
   */
  function classify(input) {
    if (input.usage === 'business') {
      return { id: 'business', name: '業務用供給方式', series: 1, safety: 1.0, forceAuto: false };
    }
    var n = input.units;
    if (n <= 1) {
      return { id: 'individual', name: '戸別供給方式', series: 1, safety: 1.0, forceAuto: false };
    }
    var safety = input.monitored ? 1.0 : 1.1;
    if (n <= 10) {
      var series = input.series === 1 ? 1 : 2;
      return { id: 'small', name: '小規模集団供給方式（2〜10戸）', series: series, safety: safety, forceAuto: true, seriesSelectable: true };
    }
    return { id: 'medium', name: '中規模集団供給方式（11〜69戸）', series: 2, safety: safety, forceAuto: true, overLimit: n >= 70 };
  }

  function validate(input) {
    var errors = {};
    if (!isPositive(input.perUnit)) {
      errors.perUnit = '1件あたりのガス消費量は0より大きい数値を入力してください。';
    }
    if (!(Number.isInteger(input.units) && input.units >= 1)) {
      errors.units = '件数は1以上の整数を入力してください。';
    }
    var p = input.simultaneityPct;
    if (!(typeof p === 'number' && isFinite(p) && p > 0 && p <= 100)) {
      errors.simultaneityPct = '同時使用率は0より大きく100以下の数値を入力してください。';
    }
    var m = input.monthlyPerUnit;
    var hasMonthly = m !== null && m !== undefined;
    if ((input.inputUnit === 'm3h' || (hasMonthly && input.monthlyUnit !== 'kg')) && !isPositive(input.kgPerM3)) {
      errors.kgPerM3 = '換算係数は0より大きい数値を入力してください。';
    }
    if (hasMonthly && !(typeof m === 'number' && isFinite(m) && m >= 0)) {
      errors.monthlyPerUnit = '1か月のガス消費量は0以上の数値を入力するか、空欄にしてください。';
    }
    return errors;
  }

  // 容器交換周期の目安（参考資料の算定例と同じ考え方）
  function exchangeEstimate(monthlyTotalKg, sizeKg, perSide) {
    if (!isPositive(monthlyTotalKg)) return null;
    var perMonth = monthlyTotalKg / sizeKg / perSide; // 1か月に使い切る「使用側一式」の数
    if (perMonth >= 1) {
      return { perMonth: ceilSafe(perMonth), label: '月' + ceilSafe(perMonth) + '回' };
    }
    var months = Math.floor(1 / perMonth + EPS);
    return { everyMonths: months, label: months + 'か月に1回' };
  }

  function calculate(input) {
    var errors = validate(input);
    if (Object.keys(errors).length > 0) {
      return { ok: false, errors: errors };
    }

    var type = classify(input);
    var regulator = type.forceAuto ? 'auto' : (input.regulator === 'single' ? 'single' : 'auto');

    var totalInput = input.perUnit * input.units;
    var peakInput = totalInput * input.simultaneityPct / 100;
    var peakKW = input.inputUnit === 'm3h' ? peakInput * input.kgPerM3 * KW_PER_KGH : peakInput;
    var peakKgh = peakKW / KW_PER_KGH;
    var designKW = peakKW * (type.series === 2 ? 0.7 : 1.0) * type.safety;
    var designKgh = designKW / KW_PER_KGH;
    var factor = regulator === 'auto' ? 2 : 1;
    // 1か月の消費量は m³/月（既定）または kg/月。m³ は時間あたりと同じ換算（1m³ ＝ 2kg 既定）で kg にする。
    var monthlyKgPerUnit = isPositive(input.monthlyPerUnit)
      ? input.monthlyPerUnit * (input.monthlyUnit === 'kg' ? 1 : input.kgPerM3)
      : null;
    var monthlyTotalKg = monthlyKgPerUnit === null ? null : monthlyKgPerUnit * input.units;

    var options = (regulator === 'auto' ? AUTO_SIZES : SIZES).map(function (size) {
      var g = lookupGenerationSafe(regulator, size, input.gas, input.tempC, input.peak);
      var opt = {
        id: 'c' + size, sizeKg: size, name: size + 'kg容器',
        generationKgh: g.value, source: g.source, substitute: g.substitute, quick: g.quick, basis: g.basis
      };
      if (g.value === null) {
        opt.available = false;
        return opt;
      }
      var nCalc = designKW / (g.value * KW_PER_KGH);
      var perSide = Math.max(1, ceilSafe(nCalc));
      opt.available = true;
      opt.nCalc = nCalc;
      opt.perSide = perSide;
      opt.total = perSide * factor;
      opt.supplyKgh = perSide * g.value;
      opt.storedKg = opt.total * size;
      opt.exchange = exchangeEstimate(monthlyTotalKg, size, perSide);
      return opt;
    });

    var available = options.filter(function (o) { return o.available; });
    var warnings = [];
    var notes = [];

    if (type.overLimit) {
      warnings.push('70戸以上はガス事業法の対象となる規模です。この計算は液化石油ガス法（69戸まで）の算定式によります。');
    }
    if (input.usage === 'business') {
      notes.push('業務用の容器は原則として50kg容器とします。');
      if (input.peak === 'cont') {
        warnings.push('業務用でピーク時間が5時間を超える場合は標準のガス発生能力が不足するおそれがあるため、強制気化方式とすることが望ましいとされています。');
      }
    }
    if (input.peak === '0.5') {
      notes.push('短時間（30分）消費の値は参考表の計算値です。');
    }
    if (input.tempC <= -10 && input.peak !== '0.5') {
      notes.push('−10℃以下は寒冷地の参考表（50kg容器・自動切替式・い号ガスのみ）の値です。');
    }
    if (available.some(function (o) { return o.quick; })) {
      notes.push('「早見表（目安）」の値は、設計基準の表に値がない条件を追加資料「LPガス 発生能力早見表」（プロパン・い号、残液約30%の目安値）で補ったものです。');
    }
    if (available.some(function (o) { return o.substitute; })) {
      notes.push('※印のガス発生能力は、選んだ条件のデータが参考資料にないため、資料内の安全側（発生能力が小さい側）の値で代用しています。');
    }
    if (type.forceAuto && input.regulator === 'single') {
      notes.push('集団供給方式では自動切替式調整器を使用します。');
    }

    // 設置場所の制限などで容器サイズを指定した場合は、そのサイズで構成する。
    var pref = input.preferredSize === undefined || input.preferredSize === null || input.preferredSize === 'auto'
      ? null : Number(input.preferredSize);
    var preferred = null;
    if (pref !== null) {
      preferred = options.filter(function (o) { return o.sizeKg === pref; })[0] || null;
      if (!preferred) {
        warnings.push(pref + 'kg容器は' + (regulator === 'auto' ? '自動切替式調整器' : 'この条件') + 'では選べません。設置本数が最少の容器を推奨します。');
        pref = null;
      } else if (!preferred.available) {
        warnings.push('指定した' + preferred.name + 'は、選んだ条件のガス発生能力のデータが参考資料にないため計算できません。条件を見直してください。');
      } else if (input.usage === 'business' && pref !== 50) {
        notes.push('業務用の容器は原則として50kg容器とします。設置場所の制限により' + preferred.name + 'で計算しています。');
      }
    }

    var recommended = null;
    if (pref !== null) {
      recommended = preferred && preferred.available ? preferred : null;
    } else {
      // 推奨: 業務用は50kg容器。それ以外は設置本数が最少の容器（同数なら大きい容器）。
      // 表どおりの値がある容器を優先し、代用値だけの場合はその中から選ぶ。
      // 設計基準の値 → 早見表の値 → 代用値 の順に、使える容器の中から選ぶ。
      var exact = available.filter(function (o) { return !o.substitute && !o.quick; });
      var quickExact = available.filter(function (o) { return !o.substitute && o.quick; });
      var pool = exact.length ? exact : quickExact.length ? quickExact : available;
      if (pool.length) {
        if (input.usage === 'business') {
          recommended = available.filter(function (o) { return o.sizeKg === 50; })[0] || null;
        } else {
          recommended = pool.slice().sort(function (a, b) {
            return a.total - b.total || b.sizeKg - a.sizeKg;
          })[0];
        }
      }
      if (!recommended) {
        warnings.push('選んだ条件（調整器・ガス・気温・ピーク時間）に該当するガス発生能力のデータが参考資料の表にありません。条件を見直してください。');
      }
    }
    if (recommended && recommended.substitute) {
      warnings.push((pref !== null ? '指定した容器' : '推奨構成') + 'のガス発生能力は代用値（' + recommended.basis + '）です。設計基準に照らして確認してください。');
    }

    return {
      ok: true,
      supplyType: type,
      regulator: regulator,
      spare: regulator === 'auto',
      totalInput: totalInput,
      peakInput: peakInput,
      peakKW: peakKW,
      peakKgh: peakKgh,
      designKW: designKW,
      designKgh: designKgh,
      // 自動切替式調整器能力 = 最大ガス消費量 × 1.0 / 14（設計例による）
      regulatorCapacityKgh: regulator === 'auto' ? peakKW / KW_PER_KGH : null,
      monthlyKgPerUnit: monthlyKgPerUnit,
      monthlyTotalKg: monthlyTotalKg,
      options: options,
      recommendedId: recommended ? recommended.id : null,
      preferredSize: pref,
      warnings: warnings,
      notes: notes
    };
  }

  return {
    KW_PER_KGH: KW_PER_KGH,
    DEFAULT_KG_PER_M3: DEFAULT_KG_PER_M3,
    GASES: GASES,
    TEMPS: TEMPS,
    PEAKS: PEAKS,
    SIZES: SIZES,
    AUTO_SIZES: AUTO_SIZES,
    TABLES: TABLES,
    lookupGeneration: lookupGeneration,
    lookupGenerationSafe: lookupGenerationSafe,
    lookupQuick: lookupQuick,
    QUICK: QUICK,
    classify: classify,
    validate: validate,
    calculate: calculate
  };
});
