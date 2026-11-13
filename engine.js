/* Exact exhaustive inverse search over the exported CatBoost prediction grid.
 * Minimize RMSE subject to max absolute error <= requested tolerance.
 * For materials without a feasible point, return their nearest-RMSE fallback.
 * Values are percentages, errors are percentage points, wavelength is nm.
 * No interpolation, retraining, silent target normalization or data alteration.
 */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.OpticalEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  var SUM_TOLERANCE = 0.01;

  function finite(value) {
    return typeof value === 'number' && Number.isFinite(value);
  }

  function validateTargets(targets) {
    if (!Array.isArray(targets) || targets.length !== 3 ||
        targets.some(function (value) { return !finite(value) || value < 0 || value > 100; })) {
      throw new Error('透射率、反射率和吸收率须为 0–100 之间的有限数值。');
    }
    var total = targets.reduce(function (sum, value) { return sum + value; }, 0);
    if (Math.abs(total - 100) > SUM_TOLERANCE + 1e-12) {
      throw new Error('三个目标光学参数之和须为 100%（允许 0.01 个百分点的输入舍入误差）。');
    }
    return targets;
  }

  function validateRequest(data, options) {
    if (!data || !data.meta || !Array.isArray(data.materials) || !data.materials.length ||
        !finite(data.meta.min_nm) || !finite(data.meta.max_nm) ||
        data.meta.min_nm > data.meta.max_nm) {
      throw new Error('模型预测数据格式不正确。');
    }
    if (!options) throw new Error('请先输入设计目标。');
    validateTargets(options.targets);
    if (!Number.isInteger(options.minNm) || !Number.isInteger(options.maxNm) ||
        options.minNm < data.meta.min_nm || options.maxNm > data.meta.max_nm ||
        options.minNm > options.maxNm) {
      throw new Error('波长范围须为 ' + data.meta.min_nm + '–' + data.meta.max_nm + ' nm 内的整数，且下限不能超过上限。');
    }
    if (!finite(options.tolerance) || options.tolerance < 0) {
      throw new Error('允许偏差须为不小于 0 的有限数值，单位为百分点。');
    }
    if (!Array.isArray(options.materials) || !options.materials.length) {
      throw new Error('请至少选择一种材料。');
    }
    var known = new Set();
    data.materials.forEach(function (material) {
      if (!material || !Number.isInteger(material.code) || known.has(material.code) ||
          typeof material.symbol !== 'string' || typeof material.name !== 'string' ||
          !Array.isArray(material.rows)) throw new Error('材料数据格式不正确。');
      known.add(material.code);
    });
    if (options.materials.some(function (code) { return !Number.isInteger(code) || !known.has(code); })) {
      throw new Error('所选材料不在模型支持范围内。');
    }
  }

  function search(data, options) {
    validateRequest(data, options);
    var chosen = new Set(options.materials);
    var targets = options.targets;
    var ranked = [];
    var count = 0;
    var feasibleCount = 0;
    data.materials.forEach(function (material) {
      if (!chosen.has(material.code)) return;
      var best = null;
      var bestFeasible = null;
      material.rows.forEach(function (row) {
        if (!Array.isArray(row) || row.length !== 4 || row.some(function (value) { return !finite(value); })) {
          throw new Error('模型预测数据包含缺失值或无效数值。');
        }
        if (row[0] < options.minNm || row[0] > options.maxNm) return;
        count += 1;
        var pred = row.slice(1);
        var errors = pred.map(function (value, index) { return value - targets[index]; });
        var squared = errors.reduce(function (sum, value) { return sum + value * value; }, 0);
        var rmse = Math.sqrt(squared / 3);
        var maxAbs = Math.max.apply(null, errors.map(Math.abs));
        var candidate = {
          code: material.code, symbol: material.symbol, name: material.name,
          nm: row[0], pred: pred, errors: errors, rmse: rmse, maxAbs: maxAbs,
          meetsTolerance: maxAbs <= options.tolerance
        };
        if (best === null || rmse < best.rmse || (rmse === best.rmse && row[0] < best.nm)) best = candidate;
        if (candidate.meetsTolerance) {
          feasibleCount += 1;
          if (bestFeasible === null || rmse < bestFeasible.rmse ||
              (rmse === bestFeasible.rmse && row[0] < bestFeasible.nm)) bestFeasible = candidate;
        }
      });
      if (best !== null) ranked.push(bestFeasible || best);
    });
    if (!ranked.length) throw new Error('所选范围内没有可用的模型预测点。');
    ranked.sort(function (a, b) {
      return Number(b.meetsTolerance) - Number(a.meetsTolerance) || a.rmse - b.rmse || a.code - b.code || a.nm - b.nm;
    });
    return { ranked: ranked, count: count, feasibleCount: feasibleCount };
  }

  function csvField(value) {
    var text = String(value);
    return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
  }

  function toCSV(targets, result, query) {
    validateTargets(targets);
    if (!result || !Array.isArray(result.ranked)) throw new Error('没有可导出的设计结果。');
    var constraints = null;
    if (query !== undefined && query !== null) {
      validateTargets(query.targets);
      if (query.targets.some(function (value, index) { return value !== targets[index]; }) ||
          !finite(query.tolerance) || query.tolerance < 0 ||
          !Number.isInteger(query.minNm) || !Number.isInteger(query.maxNm) || query.minNm > query.maxNm ||
          !Array.isArray(query.materials) || !query.materials.length ||
          query.materials.some(function (code) { return !Number.isInteger(code); })) {
        throw new Error('导出的设计约束无效或与目标参数不一致。');
      }
      // Semicolon-separated codes remain a single, human-readable CSV field.
      var codes = Array.from(new Set(query.materials)).sort(function (a, b) { return a - b; });
      constraints = [query.tolerance, query.minNm, query.maxNm, codes.join(';')];
    }
    var rows = [[
      'rank', 'material_code', 'material', 'material_name', 'wavelength_nm',
      'T_target_pct', 'R_target_pct', 'A_target_pct',
      'T_pred_pct', 'R_pred_pct', 'A_pred_pct',
      'T_error_pp', 'R_error_pp', 'A_error_pp', 'RMSE_pp', 'max_abs_error_pp', 'within_tolerance'
    ]];
    if (constraints) rows[0] = rows[0].concat(['tolerance_pp', 'min_nm', 'max_nm', 'allowed_material_codes']);
    result.ranked.forEach(function (item, index) {
      var row = [index + 1, item.code, item.symbol, item.name, item.nm]
        .concat(targets, item.pred, item.errors, [item.rmse, item.maxAbs, item.meetsTolerance]);
      rows.push(constraints ? row.concat(constraints) : row);
    });
    return rows.map(function (row) { return row.map(csvField).join(','); }).join('\r\n') + '\r\n';
  }

  return Object.freeze({ search: search, toCSV: toCSV, validateTargets: validateTargets, SUM_TOLERANCE: SUM_TOLERANCE });
});
