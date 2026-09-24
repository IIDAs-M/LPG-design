/*
 * LPガス 容器本数計算ロジック
 *
 * 計算の流れ
 *   1. 最大ガス消費量   Q_max  = 1件あたりの消費量 [m³/h] × 件数
 *   2. 必要ガス量       Q_peak = Q_max × 同時使用率 [%] / 100
 *   3. 質量換算         W_peak = Q_peak [m³/h] × 換算係数 [kg/m³]
 *   4. 容器本数(使用側) N = ceil(W_peak / 容器1本あたりのガス発生能力 [kg/h])
 *   5. 設置本数         予備側を設ける場合は N × 2
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

  // 暫定値。参考資料で確認できていないため、画面上で必ず確認・修正すること。
  var DEFAULT_COEFFICIENTS = {
    kgPerM3: 2.0,
    cylinders: [
      { id: 'c10', name: '10kg容器', capacityKg: 10, generationKgh: 0.3, enabled: true },
      { id: 'c20', name: '20kg容器', capacityKg: 20, generationKgh: 0.55, enabled: true },
      { id: 'c30', name: '30kg容器', capacityKg: 30, generationKgh: 0.7, enabled: true },
      { id: 'c50', name: '50kg容器', capacityKg: 50, generationKgh: 1.0, enabled: true }
    ]
  };

  // 浮動小数の誤差で 2.0000000001 → 3 にならないようにする
  var EPS = 1e-9;

  function ceilSafe(x) {
    return Math.ceil(x - EPS);
  }

  function isPositive(x) {
    return typeof x === 'number' && isFinite(x) && x > 0;
  }

  function validate(input) {
    var errors = {};
    if (!isPositive(input.perUnitM3h)) {
      errors.perUnitM3h = '1件あたりのガス消費量は0より大きい数値を入力してください。';
    }
    if (!(Number.isInteger(input.units) && input.units >= 1)) {
      errors.units = '件数は1以上の整数を入力してください。';
    }
    var p = input.simultaneityPct;
    if (!(typeof p === 'number' && isFinite(p) && p > 0 && p <= 100)) {
      errors.simultaneityPct = '同時使用率は0より大きく100以下の数値を入力してください。';
    }
    if (!isPositive(input.kgPerM3)) {
      errors.kgPerM3 = '換算係数は0より大きい数値を入力してください。';
    }
    var cyl = input.cylinders || [];
    cyl.forEach(function (c) {
      if (c.enabled && !isPositive(c.generationKgh)) {
        errors['gen_' + c.id] = c.name + 'のガス発生能力は0より大きい数値を入力してください。';
      }
    });
    if (!cyl.some(function (c) { return c.enabled; })) {
      errors.cylinders = '計算対象の容器を1種類以上選んでください。';
    }
    return errors;
  }

  function calculate(input) {
    var errors = validate(input);
    if (Object.keys(errors).length > 0) {
      return { ok: false, errors: errors };
    }

    var totalM3h = input.perUnitM3h * input.units;
    var peakM3h = totalM3h * input.simultaneityPct / 100;
    var peakKgh = peakM3h * input.kgPerM3;
    var factor = input.spare ? 2 : 1;

    var options = input.cylinders
      .filter(function (c) { return c.enabled; })
      .map(function (c) {
        var perSide = Math.max(1, ceilSafe(peakKgh / c.generationKgh));
        var supplyKgh = perSide * c.generationKgh;
        return {
          id: c.id,
          name: c.name,
          capacityKg: c.capacityKg,
          generationKgh: c.generationKgh,
          perSide: perSide,
          total: perSide * factor,
          supplyKgh: supplyKgh,
          marginPct: (supplyKgh / peakKgh - 1) * 100,
          storedKg: isPositive(c.capacityKg) ? perSide * factor * c.capacityKg : null
        };
      });

    // 設置本数が最少のものを推奨。同数ならガス発生能力の余裕が小さい
    // (=容器が小さく扱いやすい)方を優先する。
    var recommended = options.slice().sort(function (a, b) {
      return a.total - b.total || a.supplyKgh - b.supplyKgh;
    })[0];

    return {
      ok: true,
      totalM3h: totalM3h,
      peakM3h: peakM3h,
      peakKgh: peakKgh,
      spare: !!input.spare,
      options: options,
      recommendedId: recommended.id
    };
  }

  return {
    DEFAULT_COEFFICIENTS: DEFAULT_COEFFICIENTS,
    validate: validate,
    calculate: calculate
  };
});
