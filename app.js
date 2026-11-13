(function () {
'use strict';
const $ = id => document.getElementById(id);
const fields = ['t', 'r', 'a'], symbols = ['T', 'R', 'A'], names = ['透射率', '反射率', '吸收率'];
const data = window.OPTICAL_DATA, engine = window.OpticalEngine;
let current = null, query = null, selected = null, dirty = false;
const number = id => $(id).value.trim() === '' ? NaN : Number($(id).value);
const fmt = (x, d = 2) => Number(x).toFixed(d);
const escape = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));

function fillSlider(key) {
  const value = number('target-' + key);
  $('range-' + key).style.setProperty('--fill', Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0)) + '%');
}
function updateBalance() {
  const values = fields.map(k => number('target-' + k)), sum = values.reduce((a, b) => a + b, 0);
  let valid = true;
  try { engine.validateTargets(values); } catch (_) { valid = false; }
  $('balance').classList.toggle('good', valid);
  $('balance').textContent = Number.isFinite(sum) ? `合计 ${fmt(sum, 1)}%${valid ? ' ✓' : ' · 应为 100%'}` : '请填写三个目标值';
  fields.forEach(fillSlider);
}
function markDirty() {
  dirty = true;
  $('stale-banner').hidden = !current;
  $('results-content').classList.toggle('results-stale', !!current);
  $('export-csv').disabled = true;
  $('form-error').hidden = true;
  updateBalance();
}
function getQuery() {
  const targets = fields.map(k => number('target-' + k));
  engine.validateTargets(targets);
  const minNm = number('min-nm'), maxNm = number('max-nm');
  if (!Number.isInteger(minNm) || !Number.isInteger(maxNm) || minNm < 248 || maxNm > 2000 || minNm > maxNm) throw new Error('波长须为 248–2000 nm 内的整数，且最低值不能高于最高值。');
  const materials = [...document.querySelectorAll('input[name="material"]:checked')].map(e => Number(e.value));
  if (!materials.length) throw new Error('请至少选择一种候选材料。');
  const tolerance = number('tolerance');
  if (!Number.isFinite(tolerance) || tolerance < 0 || tolerance > 100) throw new Error('允许偏差须为 0–100 之间的数字，单位为百分点。');
  return {targets, minNm, maxNm, materials, tolerance};
}
function showError(message) {
  $('form-error').textContent = message;
  $('form-error').hidden = false;
  $('search-status').textContent = '请先修正输入，再更新设计方案。';
  if (!current) { $('empty-state').hidden = false; $('results-content').hidden = true; }
}
function search(event) {
  if (event) event.preventDefault();
  try {
    const q = getQuery(), result = engine.search(data, q);
    if (!result.ranked.length) throw new Error('当前范围内没有候选组合，请调整搜索条件。');
    query = q; current = result; selected = result.ranked[0].code; dirty = false;
    $('form-error').hidden = true; $('stale-banner').hidden = true; $('empty-state').hidden = true;
    $('results-content').hidden = false; $('results-content').classList.remove('results-stale');
    $('export-csv').disabled = false;
    const count = result.count ?? q.materials.length * (q.maxNm - q.minNm + 1);
    const feasible = Number(result.feasibleCount || 0);
    $('search-status').textContent = `已比较 ${count.toLocaleString('zh-CN')} 个组合 · ${feasible.toLocaleString('zh-CN')} 个满足偏差 · 1 nm 网格`;
    renderSelected(); renderCandidates();
  } catch (error) { showError(error.message || '计算暂时不可用，请检查数据文件。'); }
}
function renderCandidates() {
  $('candidate-count').textContent = current.ranked.length + ' 个候选';
  $('candidate-rows').innerHTML = current.ranked.map((row, i) => `<tr class="candidate-row ${row.code === selected ? 'selected' : ''}" data-code="${row.code}">
    <td><button class="candidate-name" type="button" aria-label="查看${escape(row.name)} ${escape(row.symbol)}方案" aria-pressed="${row.code === selected}"><strong>${escape(row.symbol)}</strong><span>${escape(row.name)}</span>${i === 0 ? '<span aria-label="排名第一">①</span>' : ''}</button></td>
    <td>${row.nm}</td><td class="pred-values">${row.pred.map(v => fmt(v, 1)).join(' / ')}</td><td>${fmt(row.rmse, 3)}</td>
    <td><span class="row-status ${row.meetsTolerance ? 'matched' : ''}">${row.meetsTolerance ? '满足偏差' : '近似方案'}</span></td></tr>`).join('');
}
function renderSelected() {
  const row = current.ranked.find(r => r.code === selected);
  if (!row) return;
  $('recommendation-label').textContent = row.code === current.ranked[0].code ? (row.meetsTolerance ? '满足偏差要求的最优方案' : '最接近目标的方案') : '当前查看方案';
  $('best-symbol').textContent = row.symbol; $('best-name').textContent = row.name;
  $('best-nm').textContent = row.nm; $('best-rmse').textContent = fmt(row.rmse, 3);
  $('match-badge').classList.toggle('matched', row.meetsTolerance);
  $('match-badge').textContent = row.meetsTolerance ? '✓ 三项均在允许偏差内' : '当前范围内的近似方案';
  $('response-comparison').innerHTML = row.pred.map((value, i) => `<div class="response-item">
    <div class="response-label"><b>${symbols[i]} ${names[i]}</b><span>目标 ${fmt(query.targets[i], 1)}%</span></div>
    <div class="response-value">${fmt(value)}<span>%</span></div>
    <div class="mini-bars" aria-hidden="true"><div><i style="width:${Math.max(0, Math.min(100, query.targets[i]))}%"></i></div><div><i style="width:${Math.max(0, Math.min(100, value))}%"></i></div></div>
    <div class="delta">偏差 ${value - query.targets[i] >= 0 ? '+' : ''}${fmt(value - query.targets[i])} 个百分点</div></div>`).join('');
  const maxAbs = Math.max(...row.pred.map((v, i) => Math.abs(v - query.targets[i]))), sum = row.pred.reduce((a, b) => a + b, 0);
  let explanation = row.meetsTolerance
    ? `三项最大偏差为 ${fmt(maxAbs)} 个百分点，满足设定的 ±${fmt(query.tolerance, 1)} 个百分点。`
    : `该材料最接近方案的最大偏差为 ${fmt(maxAbs)} 个百分点，未达到设定的 ±${fmt(query.tolerance, 1)} 个百分点。`;
  if (current.feasibleCount === 0) explanation = '所选范围内暂无满足偏差要求的组合，显示最接近结果。' + explanation;
  explanation += ` 预测合计 ${fmt(sum)}%。`;
  if (row.pred.some(value => value < 0 || value > 100)) explanation += ' 该方案含超出 0–100% 的模型预测，满足目标偏差不代表物理有效。';
  $('match-explanation').textContent = explanation;
  renderChart(row);
}
function renderChart(selectedRow) {
  const material = data.materials.find(m => m.code === selectedRow.code);
  const rows = material.rows.filter(r => r[0] >= query.minNm && r[0] <= query.maxNm);
  const points = rows.map(row => [row[0], Math.sqrt(row.slice(1, 4).reduce((s, v, i) => s + (v - query.targets[i]) ** 2, 0) / 3)]);
  $('chart-description').textContent = `${material.name} ${material.symbol} · ${query.minNm}–${query.maxNm} nm · 均方根误差（百分点）`;
  const W = 760, H = 218, L = 43, R = 15, TOP = 15, BOT = 33, iw = W - L - R, ih = H - TOP - BOT;
  const xmin = query.minNm, xmax = query.maxNm, ymax = Math.max(.1, ...points.map(p => p[1])) * 1.12;
  const sx = v => L + (xmax === xmin ? .5 : (v - xmin) / (xmax - xmin)) * iw;
  const sy = v => TOP + ih - v / ymax * ih;
  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="curve-title curve-desc"><title id="curve-title">${escape(material.name)}的目标误差随波长变化</title><desc id="curve-desc">推荐波长 ${selectedRow.nm} nm，RMSE ${fmt(selectedRow.rmse, 3)} 个百分点。曲线表示当前目标下的模型预测误差。</desc><defs><linearGradient id="area-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#137d72" stop-opacity=".12"/><stop offset="100%" stop-color="#137d72" stop-opacity=".01"/></linearGradient></defs>`;
  for (let i = 0; i < 5; i++) {
    const v = ymax * i / 4, y = sy(v);
    svg += `<line x1="${L}" y1="${y}" x2="${W - R}" y2="${y}" stroke="#e8eeea" stroke-width="1"/><text x="${L - 9}" y="${y + 3}" text-anchor="end" fill="#7e8e85" font-size="10">${fmt(v, v < 10 ? 1 : 0)}</text>`;
  }
  for (let i = 0; i < 5; i++) {
    if (xmax === xmin && i !== 2) continue;
    const v = xmin + (xmax - xmin) * i / 4;
    svg += `<text x="${sx(v)}" y="${H - 13}" text-anchor="middle" fill="#7e8e85" font-size="10">${Math.round(v)}</text>`;
  }
  const path = points.map((p, i) => (i ? 'L' : 'M') + sx(p[0]).toFixed(2) + ',' + sy(p[1]).toFixed(2)).join(' ');
  if (points.length > 1) svg += `<path d="${path} L${sx(points.at(-1)[0])},${TOP + ih} L${sx(points[0][0])},${TOP + ih} Z" fill="url(#area-fill)"/>`;
  svg += `<path d="${path}" fill="none" stroke="#137d72" stroke-width="1.7" stroke-linejoin="round"/>`;
  const px = sx(selectedRow.nm), py = sy(selectedRow.rmse);
  svg += `<line x1="${px}" y1="${TOP}" x2="${px}" y2="${TOP + ih}" stroke="#739f8e" stroke-width="1" stroke-dasharray="3 4"/><circle cx="${px}" cy="${py}" r="5" fill="#fff" stroke="#137d72" stroke-width="2"/></svg>`;
  $('chart').innerHTML = svg;
  $('chart').setAttribute('aria-label', `${material.name}的波长与目标误差曲线，推荐 ${selectedRow.nm} nm`);
}
function exportCSV() {
  if (!current || dirty) return;
  const content = engine.toCSV(query.targets, current, query);
  const url = URL.createObjectURL(new Blob(['\uFEFF', content], {type: 'text/csv;charset=utf-8'}));
  const a = document.createElement('a'); a.href = url; a.download = 'optical-inverse-design.csv';
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
if (window.location.protocol === 'file:') {
  $('download-source').hidden = true;
  $('offline-package').hidden = false;
}
if (!data || !engine) {
  $('search-button').disabled = true;
  document.querySelector('.model-badge').textContent = '模型数据未载入';
  $('search-status').textContent = '模型数据尚未载入。'; $('empty-state').hidden = false;
  showError('未能加载模型数据。请完整解压网页文件，并保留 predictions.js 和 engine.js。'); return;
}
$('material-options').innerHTML = data.materials.map(m => `<label class="material-option"><input type="checkbox" name="material" value="${m.code}" checked><strong>${escape(m.symbol)}</strong><span>${escape(m.name)}</span></label>`).join('');
fields.forEach(key => {
  $('target-' + key).addEventListener('input', () => { const v = number('target-' + key); $('range-' + key).value = Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : 0; markDirty(); });
  $('range-' + key).addEventListener('input', () => { $('target-' + key).value = $('range-' + key).value; markDirty(); });
});
['min-nm', 'max-nm', 'tolerance'].forEach(id => $(id).addEventListener('input', markDirty));
$('material-options').addEventListener('change', markDirty);
$('derive-a').addEventListener('click', () => {
  const t = number('target-t'), r = number('target-r');
  if (!Number.isFinite(t) || !Number.isFinite(r) || t < 0 || r < 0 || t + r > 100) { showError('自动计算 A 需要 T、R 非负，且 T + R 不超过 100%。'); return; }
  $('target-a').value = Number((100 - t - r).toFixed(3)); $('range-a').value = $('target-a').value; markDirty();
});
$('all-materials').addEventListener('click', () => { document.querySelectorAll('input[name="material"]').forEach(e => e.checked = true); markDirty(); });
document.querySelectorAll('[data-preset]').forEach(button => button.addEventListener('click', () => {
  button.dataset.preset.split(',').forEach((v, i) => { $('target-' + fields[i]).value = v; $('range-' + fields[i]).value = v; }); markDirty();
}));
$('design-form').addEventListener('submit', search);
$('candidate-rows').addEventListener('click', event => {
  const row = event.target.closest('[data-code]'); if (!row || dirty) return;
  selected = Number(row.dataset.code); renderSelected(); renderCandidates();
});
$('export-csv').addEventListener('click', exportCSV);
updateBalance(); search();
})();
