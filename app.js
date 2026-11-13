(function () {
'use strict';
const $ = id => document.getElementById(id);
const fields = ['t', 'r', 'a'];
const symbols = ['T', 'R', 'A'];
const names = ['Transmittance', 'Reflectance', 'Absorptance'];
const colors = ['#168779', '#6282ad', '#d28465'];
const materialNames = {Au: 'Gold', Sn: 'Tin', Mo: 'Molybdenum', Ni: 'Nickel', Cu: 'Copper', Al: 'Aluminium'};
const rawData = window.OPTICAL_DATA, engine = window.OpticalEngine;
const number = id => $(id).value.trim() === '' ? NaN : Number($(id).value);
const fmt = (x, d = 2) => Number(x).toFixed(d);
const escape = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
let current = null, query = null, selected = null, dirty = false, plotMode = 'spectrum';
let forwardResult = null, forwardDirty = false;
function renderValidation() {
  const saved = window.OPTICAL_VALIDATION;
  const valid = saved && saved.meta && saved.meta.model === 'CatBoost' &&
    saved.meta.confidence_level === .95 && Number.isInteger(saved.meta.test_rows) &&
    saved.meta.test_rows > 0 && Number.isInteger(saved.meta.bootstrap_resamples) &&
    saved.meta.bootstrap_resamples > 0 && Array.isArray(saved.metrics) && saved.metrics.length === 3 &&
    saved.metrics.every((row, i) => row.target === symbols[i] && Number.isFinite(row.mae_pp) &&
      Array.isArray(row.mae_ci95_pp) && row.mae_ci95_pp.length === 2 && row.mae_ci95_pp.every(Number.isFinite) &&
      row.mae_ci95_pp[0] >= 0 && row.mae_ci95_pp[0] <= row.mae_pp && row.mae_pp <= row.mae_ci95_pp[1]);
  if (!valid) {
    $('validation-table').hidden = true;
    $('validation-note').textContent = 'Saved validation metrics unavailable.';
    return;
  }
  $('validation-sample').textContent = `${saved.meta.test_rows} held-out records · ${saved.meta.bootstrap_resamples.toLocaleString('en-US')} resamples`;
  $('validation-rows').innerHTML = saved.metrics.map(row => `<tr><th scope="row">${row.target}</th><td>${fmt(row.mae_pp, 3)}</td><td>${row.mae_ci95_pp.map(v => fmt(v, 3)).join('–')}</td></tr>`).join('');
  $('validation-note').textContent = '95% bootstrap intervals describe test-set MAE, not individual predictions.';
}
renderValidation();
if (!rawData || !engine) {
  $('search-button').disabled = true; $('forward-button').disabled = true;
  document.querySelector('.model-badge').textContent = 'Data unavailable';
  $('search-status').textContent = 'Keep predictions.js and engine.js beside this page.';
  $('form-error').hidden = false; $('form-error').textContent = 'Model data could not be loaded.';
  return;
}
// Translate display metadata only. All original model values remain unchanged.
const data = {...rawData, materials: rawData.materials.map(m => ({...m, name: materialNames[m.symbol] || m.symbol}))};
function fillSlider(key) {
  const value = number('target-' + key);
  $('range-' + key).style.setProperty('--fill', Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0)) + '%');
}
function updateBalance() {
  const values = fields.map(k => number('target-' + k)), sum = values.reduce((a, b) => a + b, 0);
  let valid = true;
  try { engine.validateTargets(values); } catch (_) { valid = false; }
  $('balance').classList.toggle('good', valid);
  $('balance').textContent = Number.isFinite(sum) ? `Total ${fmt(sum, 1)}%${valid ? ' ✓' : ' · must be 100%'}` : 'Enter all three targets';
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
  if (!Number.isInteger(minNm) || !Number.isInteger(maxNm) || minNm < data.meta.min_nm || maxNm > data.meta.max_nm || minNm > maxNm) throw new Error('Use whole-number bounds within 248–2000 nm, with minimum ≤ maximum.');
  const materials = [...document.querySelectorAll('input[name="material"]:checked')].map(e => Number(e.value));
  if (!materials.length) throw new Error('Select at least one metal.');
  const tolerance = number('tolerance');
  if (!Number.isFinite(tolerance) || tolerance < 0 || tolerance > 100) throw new Error('Enter a tolerance between 0 and 100 percentage points.');
  return {targets, minNm, maxNm, materials, tolerance};
}
function showError(message) {
  $('form-error').textContent = message;
  $('form-error').hidden = false;
  $('search-status').textContent = 'Check your inputs before searching.';
  if (!current) { $('empty-state').hidden = false; $('results-content').hidden = true; }
}
function search(event) {
  if (event) event.preventDefault();
  try {
    const q = getQuery(), started = performance.now(), result = engine.search(data, q);
    const elapsed = performance.now() - started;
    if (!result.ranked.length) throw new Error('No candidates found. Adjust the search range.');
    query = q; current = result; selected = result.ranked[0].code; dirty = false;
    $('form-error').hidden = true; $('stale-banner').hidden = true; $('empty-state').hidden = true;
    $('results-content').hidden = false; $('results-content').classList.remove('results-stale');
    $('export-csv').disabled = false;
    $('search-status').textContent = `${result.count.toLocaleString('en-US')} combinations · ${result.feasibleCount.toLocaleString('en-US')} within tolerance · ${fmt(elapsed, 1)} ms search`;
    renderSelected(); renderCandidates();
  } catch (error) { showError(error.message || 'The search could not be completed.'); }
}
function renderCandidates() {
  $('candidate-count').textContent = current.ranked.length + ' metals';
  $('candidate-rows').innerHTML = current.ranked.map((row, i) => `<tr class="candidate-row ${row.code === selected ? 'selected' : ''}" data-code="${row.code}">
    <td><button class="candidate-name" type="button" aria-label="View ${escape(row.name)} design" aria-pressed="${row.code === selected}" ${dirty ? 'disabled' : ''}><strong>${escape(row.symbol)}</strong><span>${escape(row.name)}</span>${i === 0 ? '<span aria-label="Top ranked">①</span>' : ''}</button></td>
    <td>${row.nm}</td><td class="pred-values">${row.pred.map(v => fmt(v, 1)).join(' / ')}</td><td>${fmt(row.rmse, 3)}</td>
    <td><span class="row-status ${row.meetsTolerance ? 'matched' : ''}">${row.meetsTolerance ? 'Within tolerance' : 'Outside tolerance'}</span></td></tr>`).join('');
}
function physicalNote(pred) {
  return pred.some(v => v < 0 || v > 100) ? ' Values outside 0–100% are raw model outputs, not physically valid measurements.' : '';
}
function renderSelected() {
  const row = current.ranked.find(r => r.code === selected);
  if (!row) return;
  $('recommendation-label').textContent = row.code === current.ranked[0].code ? (row.meetsTolerance ? 'BEST MATCH' : 'CLOSEST AVAILABLE') : 'SELECTED CANDIDATE';
  $('best-symbol').textContent = row.symbol; $('best-name').textContent = row.name;
  $('best-nm').textContent = row.nm; $('best-rmse').textContent = fmt(row.rmse, 3);
  $('match-badge').classList.toggle('matched', row.meetsTolerance);
  $('match-badge').textContent = row.meetsTolerance ? '✓ Within tolerance' : 'Outside tolerance';
  $('response-comparison').innerHTML = row.pred.map((value, i) => `<div class="response-item">
    <div class="response-label"><b>${symbols[i]}</b><span>Target ${fmt(query.targets[i], 1)}%</span></div>
    <div class="response-value" aria-label="Predicted ${names[i]} ${fmt(value)} percent">${fmt(value)}<span>%</span></div>
    <div class="mini-bars" aria-hidden="true"><div><i style="width:${Math.max(0, Math.min(100, query.targets[i]))}%"></i></div><div><i style="width:${Math.max(0, Math.min(100, value))}%"></i></div></div>
    <div class="delta">Δ ${value - query.targets[i] >= 0 ? '+' : ''}${fmt(value - query.targets[i])} pp</div></div>`).join('');
  const maxAbs = Math.max(...row.pred.map((v, i) => Math.abs(v - query.targets[i])));
  let explanation = current.feasibleCount === 0 ? 'No combination meets all three targets within tolerance. ' : '';
  explanation += `Max. deviation ${fmt(maxAbs)} pp · tolerance ±${fmt(query.tolerance, 1)} pp.`;
  explanation += physicalNote(row.pred);
  $('match-explanation').textContent = explanation;
  renderInverseChart(row);
}
// Charts use all exported grid points; no interpolated predictions or clipped values.
function plotFrame(rows, bounds, yLow, yHigh, id, title, description, yLabel) {
  const W = 760, H = 255, L = 48, R = 17, TOP = 17, BOT = 43, iw = W - L - R, ih = H - TOP - BOT;
  const [xmin, xmax] = bounds;
  const sx = v => L + (xmax === xmin ? .5 : (v - xmin) / (xmax - xmin)) * iw;
  const sy = v => TOP + ih - (v - yLow) / (yHigh - yLow) * ih;
  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="${id}-title ${id}-desc"><title id="${id}-title">${escape(title)}</title><desc id="${id}-desc">${escape(description)}</desc>`;
  for (let i = 0; i < 5; i++) {
    const v = yLow + (yHigh - yLow) * i / 4, y = sy(v);
    svg += `<line x1="${L}" y1="${y}" x2="${W-R}" y2="${y}" stroke="#e8eeea"/><text x="${L-8}" y="${y+4}" text-anchor="end" fill="#6d7b82" font-size="11">${fmt(v, Math.abs(v) < 10 && v !== 0 ? 1 : 0)}</text>`;
  }
  for (let i = 0; i < 5; i++) {
    if (xmin === xmax && i !== 2) continue;
    const v = xmin + (xmax - xmin) * i / 4;
    svg += `<text x="${sx(v)}" y="${H-25}" text-anchor="middle" fill="#6d7b82" font-size="11">${Math.round(v)}</text>`;
  }
  svg += `<text x="${W/2}" y="${H-4}" text-anchor="middle" fill="#6d7b82" font-size="11">Wavelength (nm)</text><text x="${L}" y="10" fill="#6d7b82" font-size="10">${yLabel}</text>`;
  return {svg, sx, sy, TOP, bottom:TOP+ih, L, right:W-R};
}
function drawSpectrum(container, material, minNm, maxNm, point, targets, id) {
  const rows = material.rows.filter(r => r[0] >= minNm && r[0] <= maxNm);
  let ymin = 0, ymax = 100;
  rows.forEach(row => row.slice(1).forEach(v => { ymin = Math.min(ymin, v); ymax = Math.max(ymax, v); }));
  if (ymin < 0) ymin = Math.floor(ymin / 5) * 5;
  if (ymax > 100) ymax = Math.ceil(ymax / 5) * 5;
  const frame = plotFrame(rows, [minNm,maxNm], ymin,ymax,id,`${material.name} predicted optical spectrum`, `Model-predicted T, R and A at 1 nm intervals. Selected wavelength ${point.nm} nm. Solid lines show predictions.${targets ? ' Dashed horizontal lines show targets.' : ''}`, 'Response (%)');
  let {svg,sx,sy} = frame;
  if (targets) targets.forEach((value,i) => { svg += `<line x1="${frame.L}" x2="${frame.right}" y1="${sy(value)}" y2="${sy(value)}" stroke="${colors[i]}" opacity=".55" stroke-dasharray="5 5"/>`; });
  rows.length && colors.forEach((color,i) => {
    const path = rows.map((row,j) => `${j ? 'L' : 'M'}${sx(row[0]).toFixed(2)},${sy(row[i+1]).toFixed(2)}`).join(' ');
    svg += `<path d="${path}" fill="none" stroke="${color}" stroke-width="1.8" stroke-linejoin="round"/>`;
  });
  svg += `<line x1="${sx(point.nm)}" x2="${sx(point.nm)}" y1="${frame.TOP}" y2="${frame.bottom}" stroke="#81918a" stroke-dasharray="3 4"/>`;
  point.pred.forEach((v,i) => { svg += `<circle cx="${sx(point.nm)}" cy="${sy(v)}" r="4" fill="white" stroke="${colors[i]}" stroke-width="2"/>`; });
  $(container).innerHTML = svg + '</svg>';
  $(container).setAttribute('aria-label', `${material.name}: predicted T, R and A. Selected wavelength ${point.nm} nm.`);
}
function renderInverseChart(row) {
  const material = data.materials.find(m => m.code === row.code);
  $('chart-title').textContent = plotMode === 'spectrum' ? 'Optical spectrum' : 'Target mismatch';
  $('chart-description').textContent = `${material.name} (${material.symbol}) · ${query.minNm}–${query.maxNm} nm`;
  $('chart-caption-copy').textContent = plotMode === 'spectrum' ? 'Solid: predicted · dashed: target · dots: selected wavelength' : 'Lower RMSE means a closer match to the target.';
  $('chart-legend').innerHTML = plotMode === 'spectrum' ? colors.map((color,i) => `<span><i style="background:${color}"></i>${symbols[i]}</span>`).join('') : '<span><i></i>RMSE (pp)</span>';
  if (plotMode === 'spectrum') { drawSpectrum('chart',material,query.minNm,query.maxNm,row,query.targets,'inverse-spectrum'); return; }
  const points = material.rows.filter(r => r[0] >= query.minNm && r[0] <= query.maxNm).map(r => [r[0],Math.sqrt(r.slice(1).reduce((s,v,i)=>s+(v-query.targets[i])**2,0)/3)]);
  const ymax = Math.max(.1,...points.map(p => p[1]))*1.12;
  const frame = plotFrame(points,[query.minNm,query.maxNm],0,ymax,'inverse-error',`${material.name} target mismatch`,`RMSE against the requested targets at each wavelength. Selected point: ${row.nm} nm, ${fmt(row.rmse,3)} percentage points.`,'RMSE (pp)');
  let {svg,sx,sy} = frame;
  const path = points.map((p,i) => `${i ? 'L' : 'M'}${sx(p[0]).toFixed(2)},${sy(p[1]).toFixed(2)}`).join(' ');
  svg += `<path d="${path}" fill="none" stroke="#137d72" stroke-width="1.8"/><line x1="${sx(row.nm)}" x2="${sx(row.nm)}" y1="${frame.TOP}" y2="${frame.bottom}" stroke="#81918a" stroke-dasharray="3 4"/><circle cx="${sx(row.nm)}" cy="${sy(row.rmse)}" r="5" fill="white" stroke="#137d72" stroke-width="2"/></svg>`;
  $('chart').innerHTML = svg;
  $('chart').setAttribute('aria-label', `${material.name}: target mismatch versus wavelength. Selected ${row.nm} nm, RMSE ${fmt(row.rmse,3)} percentage points.`);
}
function markForwardDirty() {
  forwardDirty = true;
  const nm = number('forward-nm');
  $('forward-range').style.setProperty('--fill', Math.max(0, Math.min(100, (nm - data.meta.min_nm) / (data.meta.max_nm - data.meta.min_nm) * 100)) + '%');
  $('forward-error').hidden = true;
  $('forward-stale').hidden = !forwardResult;
  $('forward-results').classList.toggle('results-stale',!!forwardResult);
}
function predictForward(event) {
  if (event) event.preventDefault();
  try {
    const code = number('forward-material'), nm = number('forward-nm');
    const started = performance.now(), row = engine.predict(data,code,nm), elapsed = performance.now()-started;
    const material = data.materials.find(m => m.code === code);
    forwardResult = row; forwardDirty = false;
    $('forward-error').hidden = true; $('forward-stale').hidden = true;
    $('forward-results').hidden = false; $('forward-results').classList.remove('results-stale');
    $('forward-symbol').textContent = row.symbol; $('forward-name').textContent = row.name;
    $('forward-wavelength').textContent = row.nm;
    $('forward-status').textContent = `CatBoost prediction · ${fmt(elapsed,2)} ms grid lookup`;
    $('forward-responses').innerHTML = row.pred.map((v,i) => `<div class="response-item"><div class="response-label"><b>${symbols[i]} · ${names[i]}</b></div><div class="response-value">${fmt(v)}<span>%</span></div></div>`).join('');
    $('forward-note').textContent = `T + R + A = ${fmt(row.pred.reduce((a,b)=>a+b,0))}%. Raw model predictions.${physicalNote(row.pred)}`;
    drawSpectrum('forward-chart',material,data.meta.min_nm,data.meta.max_nm,row,null,'forward-spectrum');
  } catch (error) {
    $('forward-error').textContent = error.message || 'Prediction unavailable.';
    $('forward-error').hidden = false;
    $('forward-status').textContent = 'Check the material and wavelength.';
    markForwardDirty(); $('forward-error').hidden = false;
  }
}
function activateTab(mode, focus) {
  ['inverse','forward'].forEach(name => {
    const active = name === mode, tab = $('tab-'+name);
    tab.setAttribute('aria-selected',String(active)); tab.tabIndex = active ? 0 : -1;
    $('panel-'+name).hidden = !active;
    if (active && focus) tab.focus();
  });
  if (mode === 'forward' && !forwardResult) predictForward();
}
function bindTabs(ids, activate) {
  ids.forEach((id,index) => {
    $(id).addEventListener('click', () => activate(index,false));
    $(id).addEventListener('keydown', event => {
      if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? ids.length-1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + ids.length)%ids.length;
      activate(next,true);
    });
  });
}
function exportCSV() {
  if (!current || dirty) return;
  const content = engine.toCSV(query.targets,current,query);
  const url = URL.createObjectURL(new Blob(['\uFEFF',content],{type:'text/csv;charset=utf-8'}));
  const a = document.createElement('a'); a.href = url; a.download = 'optical-inverse-design.csv';
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url),1000);
}
if (window.location.protocol === 'file:') { $('download-source').hidden = true; $('offline-package').hidden = false; }
$('material-options').innerHTML = data.materials.map(m => `<label class="material-option" title="${escape(m.name)}"><input type="checkbox" name="material" value="${m.code}" aria-label="${escape(m.name)} (${m.symbol})" checked><strong>${escape(m.symbol)}</strong></label>`).join('');
$('forward-material').innerHTML = data.materials.map(m => `<option value="${m.code}">${escape(m.symbol)} — ${escape(m.name)}</option>`).join('');
fields.forEach(key => {
  $('target-'+key).addEventListener('input', () => { const v = number('target-'+key); $('range-'+key).value = Number.isFinite(v) ? Math.max(0,Math.min(100,v)) : 0; markDirty(); });
  $('range-'+key).addEventListener('input', () => { $('target-'+key).value = $('range-'+key).value; markDirty(); });
});
['min-nm','max-nm','tolerance'].forEach(id => $(id).addEventListener('input',markDirty));
$('material-options').addEventListener('change',markDirty);
$('derive-a').addEventListener('click', () => {
  const t = number('target-t'), r = number('target-r');
  if (!Number.isFinite(t) || !Number.isFinite(r) || t < 0 || r < 0 || t+r > 100) { showError('Use non-negative T and R with T + R ≤ 100%.'); return; }
  $('target-a').value = Number((100-t-r).toFixed(3)); $('range-a').value = $('target-a').value; markDirty();
});
$('all-materials').addEventListener('click', () => { document.querySelectorAll('input[name="material"]').forEach(e => e.checked = true); markDirty(); });
document.querySelectorAll('[data-preset]').forEach(button => button.addEventListener('click', () => {
  button.dataset.preset.split(',').forEach((v,i) => { $('target-'+fields[i]).value = v; $('range-'+fields[i]).value = v; }); markDirty();
}));
$('design-form').addEventListener('submit',search);
$('candidate-rows').addEventListener('click', event => {
  const row = event.target.closest('[data-code]'); if (!row || dirty) return;
  selected = Number(row.dataset.code); renderSelected(); renderCandidates();
});
$('export-csv').addEventListener('click',exportCSV);
bindTabs(['tab-inverse','tab-forward'],(i,focus) => activateTab(['inverse','forward'][i],focus));
bindTabs(['view-spectrum','view-error'],(index,focus) => {
  plotMode = ['spectrum','error'][index];
  ['view-spectrum','view-error'].forEach((id,i) => { $(id).setAttribute('aria-selected',String(i === index)); $(id).tabIndex = i === index ? 0 : -1; });
  if (focus) $(['view-spectrum','view-error'][index]).focus();
  if (current) renderInverseChart(current.ranked.find(r => r.code === selected));
});
$('forward-form').addEventListener('submit',predictForward);
$('forward-material').addEventListener('change',markForwardDirty);
$('forward-nm').addEventListener('input', () => { const n = number('forward-nm'); if (Number.isFinite(n)) $('forward-range').value = n; markForwardDirty(); });
$('forward-range').addEventListener('input', () => { $('forward-nm').value = $('forward-range').value; markForwardDirty(); });
document.querySelector('a[href="#method"]').addEventListener('click', () => { $('method').open = true; });
$('forward-range').style.setProperty('--fill', ((number('forward-nm') - data.meta.min_nm) / (data.meta.max_nm - data.meta.min_nm) * 100) + '%');
updateBalance(); search();
})();
