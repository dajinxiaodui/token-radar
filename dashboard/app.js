// Token Radar dashboard. Reads window.RADAR (written beside this folder by main.ts) and
// renders the ranked board, its filters, a per-protocol detail drawer with the price
// build-up and farm plan, the model's peer table, and the already-trading comparison set.
// No network and no framework: every byte shown comes from data.js.
//
// Views can be linked: #detail=<slug> opens a protocol, #cat=<category> pre-filters.

'use strict';

const R = window.RADAR;
const rows = R.rows;
const bySlug = new Map(rows.map((r) => [r.slug, r]));

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function money(v) {
  if (v === null || v === undefined) return '—';
  const a = Math.abs(v);
  if (a >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `$${(v / 1e3).toFixed(0)}K`;
  return `$${Math.round(v)}`;
}
function pct(v) {
  if (v === null || v === undefined) return '<span class="flat">—</span>';
  const cls = v > 0.05 ? 'pos' : v < -0.05 ? 'neg' : 'flat';
  return `<span class="${cls}">${v > 0 ? '+' : ''}${v.toFixed(1)}%</span>`;
}
function mult(v) { return v === null || v === undefined ? '—' : `${v.toFixed(2)}×`; }
function ageText(days) {
  if (days === null || days === undefined) return '—';
  if (days >= 730) return `${(days / 365.25).toFixed(1)} yrs`;
  if (days >= 60) return `${Math.round(days / 30.4)} mo`;
  return `${days} d`;
}

// ------------------------------------------------------------- masthead + stats
$('masthead-meta').innerHTML =
  `snapshot <b>${esc(R.as_of)}</b> · source <b>${esc(R.source)}</b><br>` +
  `model <b>${esc(R.model.version)}</b> · floor <b>${money(R.floor_usd)}</b>`;

const stat = (label, value, small) =>
  `<div class="stat"><span>${label}</span><b>${value}</b><small>${small}</small></div>`;
$('stats').innerHTML = [
  stat('Protocols scanned', R.universe_size, 'in the sealed snapshot'),
  stat('Pre-token found', R.pre_token_size, 'no token, gecko id or symbol'),
  stat('Rows on the board', R.board_size, `${R.watchlist_size} watchlist + ${R.early_size} early finds`),
  stat('Watchlist covered', `${R.watchlist_size} / ${R.watchlist_size}`, 'every slug ranked, none dropped'),
  stat('Peer median multiple', mult(R.model.global_median), `from ${R.model.tokenized_peers} tokenized protocols`),
].join('');

// ------------------------------------------------------------- filters
const catSel = $('f-category');
const chainSel = $('f-chain');
const categories = [...new Set(rows.map((r) => r.category).filter(Boolean))].sort();
const chains = [...new Set(rows.flatMap((r) => r.chains))].sort();
catSel.innerHTML = '<option value="">All categories</option>' + categories.map((c) => `<option>${esc(c)}</option>`).join('');
chainSel.innerHTML = '<option value="">All chains</option>' + chains.map((c) => `<option>${esc(c)}</option>`).join('');

const state = { q: '', cat: '', chain: '', watch: false, sort: 'rank', dir: 1 };
const maxRatio = Math.max(...rows.map((r) => (r.tvl_usd > 0 ? r.implied_value_usd / r.tvl_usd : 0)));

function sortKey(r) {
  switch (state.sort) {
    case 'implied': return r.implied_value_usd;
    case 'tvl': return r.tvl_usd;
    case 'change': return r.change_7d ?? -Infinity;
    case 'age': return r.age_days ?? -Infinity;
    case 'multiple': return r.category_multiple;
    default: return r.rank;
  }
}

function visible() {
  const q = state.q.trim().toLowerCase();
  const list = rows.filter((r) =>
    (q === '' || r.name.toLowerCase().includes(q) || r.slug.toLowerCase().includes(q)) &&
    (state.cat === '' || r.category === state.cat) &&
    (state.chain === '' || r.chains.includes(state.chain)) &&
    (!state.watch || r.watchlist));
  const dir = state.sort === 'rank' ? 1 : state.dir;
  return list.sort((a, b) => (sortKey(a) - sortKey(b)) * dir || a.rank - b.rank);
}

function chips(list) {
  const shown = list.slice(0, 3).map((c) => `<span class="chip">${esc(c)}</span>`).join('');
  const more = list.length > 3 ? `<span class="chip more">+${list.length - 3}</span>` : '';
  return `<div class="chips">${shown}${more}</div>`;
}

function renderBoard() {
  const list = visible();
  $('row-count').textContent = `${list.length} of ${rows.length} rows`;
  $('board-empty').hidden = list.length !== 0;
  $('board-body').innerHTML = list.map((r) => {
    const ratio = r.tvl_usd > 0 ? r.implied_value_usd / r.tvl_usd : 0;
    const width = Math.max(2, Math.min(100, (ratio / maxRatio) * 100));
    return `<tr data-slug="${esc(r.slug)}" tabindex="0" aria-label="${esc(r.name)} detail">
      <td class="rank">${r.rank}</td>
      <td><span class="pname">${r.watchlist ? '<span class="star" title="On the snapshot watchlist">★</span>' : ''}${esc(r.name)}</span><span class="slug">${esc(r.slug)}</span></td>
      <td class="cat">${esc(r.category ?? '—')}</td>
      <td>${chips(r.chains)}</td>
      <td class="num">${money(r.tvl_usd)}</td>
      <td class="num">${pct(r.change_7d)}</td>
      <td class="num">${ageText(r.age_days)}</td>
      <td class="num implied">${money(r.implied_value_usd)}</td>
      <td class="bar-cell"><div class="bar"><i style="width:${width.toFixed(1)}%"></i></div><span class="bar-note">${ratio.toFixed(2)}× TVL</span></td>
    </tr>`;
  }).join('');
}

$('q').addEventListener('input', (e) => { state.q = e.target.value; renderBoard(); });
catSel.addEventListener('change', (e) => { state.cat = e.target.value; renderBoard(); });
chainSel.addEventListener('change', (e) => { state.chain = e.target.value; renderBoard(); });
$('f-watch').addEventListener('change', (e) => { state.watch = e.target.checked; renderBoard(); });
$('f-sort').addEventListener('change', (e) => { state.sort = e.target.value; renderBoard(); });
$('f-dir').addEventListener('click', (e) => {
  state.dir = -state.dir;
  e.target.textContent = state.dir === 1 ? '↓ Desc' : '↑ Asc';
  renderBoard();
});

// ------------------------------------------------------------- detail drawer
const detail = $('detail');
const scrim = $('scrim');
let openSlug = null;

function factorRow(label, value, note) {
  return `<div class="brow"><span>${label} <small>${note}</small></span><b>${value}</b></div>`;
}
function openDetail(slug) {
  const r = bySlug.get(slug);
  if (!r) return;
  openSlug = slug;
  const ratio = r.tvl_usd > 0 ? (r.implied_value_usd / r.tvl_usd).toFixed(2) : '—';
  $('detail-in').innerHTML = `
    <div class="detail-head">
      <div>
        <h2>${esc(r.name)}${r.watchlist ? '<span class="badge">Watchlist</span>' : ''}</h2>
        <p class="sub">Rank #${r.rank} of ${R.board_size} · ${esc(r.category ?? 'Uncategorised')} · ${esc(r.slug)}</p>
      </div>
      <button class="close-btn" id="d-close" type="button" aria-label="Close detail">×</button>
    </div>

    <h3>Snapshot facts</h3>
    <div class="kv">
      <div><span>TVL</span><b>${money(r.tvl_usd)}</b></div>
      <div><span>7d change</span><b>${r.change_7d === null ? '—' : `${r.change_7d > 0 ? '+' : ''}${r.change_7d.toFixed(1)}%`}</b></div>
      <div><span>Listed</span><b>${esc(r.listed_at ?? 'unknown')}</b></div>
      <div><span>Age, no token</span><b>${ageText(r.age_days)}</b></div>
      <div><span>Chains</span><b>${r.chains.length}</b></div>
      <div><span>Implied ÷ TVL</span><b>${ratio}×</b></div>
    </div>
    <p class="sub" style="margin-top:10px">Chains: ${r.chains.map(esc).join(', ') || 'none recorded'}</p>

    <h3>How this price is made</h3>
    <div class="buildup">
      ${factorRow('TVL (snapshot)', money(r.tvl_usd), '')}
      ${factorRow('× category multiple', mult(r.category_multiple), `${esc(r.category ?? 'all')} median, ${r.category_peers} tokenized peer${r.category_peers === 1 ? '' : 's'}, shrunk to the market median`)}
      ${factorRow('× growth', `×${r.growth_multiplier.toFixed(3)}`, 'half the clamped 7-day TVL change')}
      ${factorRow('× maturity', `×${r.maturity_multiplier.toFixed(3)}`, 'credit for years run without a token')}
      ${factorRow('× reach', `×${r.reach_multiplier.toFixed(3)}`, `${r.chains.length} chain(s) live`)}
      <div class="brow total"><span>Implied value</span><b>${money(r.implied_value_usd)}</b></div>
    </div>

    <h3>Farm plan — ${r.farm_steps.length} steps</h3>
    <ol class="steps">${r.farm_steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>`;
  detail.hidden = false;
  scrim.hidden = false;
  $('d-close').addEventListener('click', closeDetail);
  document.querySelectorAll('#board-body tr').forEach((tr) => tr.classList.toggle('selected', tr.dataset.slug === slug));
}
function closeDetail() {
  openSlug = null;
  detail.hidden = true;
  scrim.hidden = true;
  document.querySelectorAll('#board-body tr').forEach((tr) => tr.classList.remove('selected'));
}
$('board-body').addEventListener('click', (e) => {
  const tr = e.target.closest('tr[data-slug]');
  if (tr) openDetail(tr.dataset.slug);
});
$('board-body').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  const tr = e.target.closest('tr[data-slug]');
  if (tr) openDetail(tr.dataset.slug);
});
scrim.addEventListener('click', closeDetail);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDetail(); });

// ------------------------------------------------------------- model section
const m = R.model;
$('model').innerHTML = `
  <h2>How the price is made</h2>
  <p class="lede">No name on this board was priced by hand. Each protocol is priced at the multiple the
  market already pays for its tokenized peers: the median market-cap ÷ TVL of its category, shrunk toward
  the snapshot-wide median of ${mult(m.global_median)} by ${m.shrink_peers} phantom peers (so a category with
  one loud peer cannot set its own price), clamped to ${mult(m.mult_floor)}–${mult(m.mult_cap)}, then adjusted
  for the week's growth, for years run without a token, and for chain reach. Open any row to re-price it by hand.</p>
  <div class="formula">multiple&nbsp; = clamp( (peers × category median + ${m.shrink_peers} × ${m.global_median.toFixed(3)}) ÷ (peers + ${m.shrink_peers}), ${m.mult_floor}, ${m.mult_cap} )<br>
  implied&nbsp;&nbsp; = TVL × multiple × (1 + clamp(7d change, −60%, +120%) × ${m.growth_weight}) × (0.7 + 0.5 × min(age, 1095d) ÷ 1095) × (1 + 0.04 × min(chains − 1, 5))</div>
  <div class="ptable-wrap"><table class="ptable">
    <thead><tr><th>Category</th><th class="num">Tokenized peers</th><th class="num">Raw median</th><th class="num">Applied multiple</th></tr></thead>
    <tbody>${m.categories.map((c) => `<tr><td>${esc(c.category)}</td><td class="num">${c.peers}</td><td class="num">${mult(c.median)}</td><td class="num">${mult(c.applied)}</td></tr>`).join('')}</tbody>
  </table></div>`;

// ------------------------------------------------------------- live section
$('live').innerHTML = `
  <h2>Already trading — the comparison set</h2>
  <p class="lede">These protocols already have tokens, so the board never ranks them; it learns from them.
  Their actual market-cap ÷ TVL multiples are the raw material of the peer table above.</p>
  <div class="ltable-wrap"><table class="ltable">
    <thead><tr><th>Protocol</th><th>Category</th><th class="num">TVL</th><th class="num">Market cap</th><th class="num">Actual multiple</th><th class="num">7d</th></tr></thead>
    <tbody>${R.live.map((p) => `<tr>
      <td><span class="pname">${esc(p.name)}</span><span class="slug">${esc(p.slug)}</span></td>
      <td class="cat">${esc(p.category ?? '—')}</td>
      <td class="num">${money(p.tvl_usd)}</td>
      <td class="num">${money(p.mcap_usd)}</td>
      <td class="num">${mult(p.multiple)}</td>
      <td class="num">${pct(p.change_7d)}</td>
    </tr>`).join('')}</tbody>
  </table></div>`;

// ------------------------------------------------------------- footer
$('foot').innerHTML = `
  <p><b>Coverage.</b> The board always carries all ${R.watchlist_size} watchlist protocols. Below the
  ${money(R.floor_usd)} TVL floor it adds ${R.early_size} early finds of its own: pre-token protocols that are not
  centralised exchanges, not canonical bridges, and not versioned deployments of a protocol whose token already
  trades — three classes that do not launch tokens of their own.</p>
  <p><b>Reading the price.</b> An implied value is what this protocol's TVL would be worth if the market priced it
  like its category's tokenized peers today. It is a comparison, not a forecast: it moves with peer prices, and a
  token launch, if one comes, will price differently. Farm plans are generated from each protocol's own category,
  chains, TVL and age; amounts are test-position sizes, not recommendations.</p>
  <p>Data: ${esc(R.source)} snapshot of ${esc(R.as_of)} · model ${esc(R.model.version)} · this page is static and works offline.</p>`;

// ------------------------------------------------------------- linked views
renderBoard();
const hash = new URLSearchParams(location.hash.slice(1));
if (hash.get('cat')) {
  state.cat = hash.get('cat');
  catSel.value = state.cat;
  renderBoard();
}
if (hash.get('detail')) openDetail(hash.get('detail'));
