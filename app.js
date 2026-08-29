/* ---------- config ---------- */
const API = 'https://pokeapi.co/api/v2';
const SPRITE_BASE = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon';
const TOTAL_POKEMON = 1025;
const PAGE_SIZE = 40;

const TYPE_COLORS = {
  normal:'#A8A77A', fire:'#EE8130', water:'#6390F0', electric:'#F7D02C',
  grass:'#7AC74C', ice:'#96D9D6', fighting:'#C22E28', poison:'#A33EA1',
  ground:'#E2BF65', flying:'#A98FF3', psychic:'#F95587', bug:'#A6B91A',
  rock:'#B6A136', ghost:'#735797', dragon:'#6F35FC', dark:'#705746',
  steel:'#B7B7CE', fairy:'#D685AD'
};

const STAT_LABELS = {
  hp: 'PV', attack: 'Attaque', defense: 'Défense',
  'special-attack': 'Atq. Spé', 'special-defense': 'Déf. Spé', speed: 'Vitesse'
};

/* ---------- state ---------- */
let allNames = [];       // [{name, id}] full national dex list
let filteredNames = [];  // after search/type filter
let renderedCount = 0;
let currentIndex = -1;   // index into filteredNames of the selected pokemon
let currentData = null;
let showShiny = false;
let activeTypeFilters = new Set();
const detailCache = new Map();
const moveCache = new Map();

/* ---------- cache (localStorage) ---------- */
const store = {
  get(key) {
    try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
  },
  set(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* quota: ignore */ }
  }
};

/* ---------- dom refs ---------- */
const $ = (id) => document.getElementById(id);
const listGrid = $('listGrid');
const loadMoreBtn = $('loadMore');
const searchInput = $('searchInput');
const searchCount = $('searchCount');
const typeFilters = $('typeFilters');
const screenEmpty = $('screenEmpty');
const screenContent = $('screenContent');
const cacheStatus = $('cacheStatus');

/* ---------- init ---------- */
init();

async function init() {
  buildTypeFilters();
  bindEvents();
  await loadNameList();
  applyFilters();
}

function buildTypeFilters() {
  typeFilters.innerHTML = '';
  Object.keys(TYPE_COLORS).forEach((type) => {
    const chip = document.createElement('button');
    chip.className = 'filter-chip';
    chip.textContent = type;
    chip.style.setProperty('--type-color', TYPE_COLORS[type]);
    chip.addEventListener('click', () => {
      if (activeTypeFilters.has(type)) activeTypeFilters.delete(type);
      else activeTypeFilters.add(type);
      chip.classList.toggle('is-active', activeTypeFilters.has(type));
      applyFilters();
    });
    typeFilters.appendChild(chip);
  });
}

function bindEvents() {
  searchInput.addEventListener('input', debounce(applyFilters, 120));
  loadMoreBtn.addEventListener('click', () => renderList(true));
  $('shinyToggle').addEventListener('click', toggleShiny);
  $('prevPk').addEventListener('click', () => stepSelection(-1));
  $('nextPk').addEventListener('click', () => stepSelection(1));
  $('tabs').addEventListener('click', (e) => {
    const btn = e.target.closest('.tab');
    if (!btn) return;
    selectTab(btn.dataset.tab);
  });
  document.addEventListener('keydown', (e) => {
    if (document.activeElement === searchInput) return;
    if (e.key === 'ArrowRight') stepSelection(1);
    if (e.key === 'ArrowLeft') stepSelection(-1);
  });
}

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

/* ---------- name list (cached) ---------- */
async function loadNameList() {
  const cached = store.get('pkdx_namelist_v1');
  if (cached && cached.length === TOTAL_POKEMON) {
    allNames = cached;
    setCacheStatus('liste chargée du cache');
    return;
  }
  setCacheStatus('chargement de la liste…');
  const res = await fetch(`${API}/pokemon?limit=${TOTAL_POKEMON}&offset=0`);
  const data = await res.json();
  allNames = data.results.map((p, i) => ({ name: p.name, id: i + 1 }));
  store.set('pkdx_namelist_v1', allNames);
  setCacheStatus('liste en cache');
}

function setCacheStatus(msg) {
  cacheStatus.textContent = msg;
  setTimeout(() => { if (cacheStatus.textContent === msg) cacheStatus.textContent = ''; }, 2500);
}

/* ---------- filtering / list rendering ---------- */
function applyFilters() {
  const q = searchInput.value.trim().toLowerCase();
  let list = allNames;

  if (q) {
    list = list.filter(p => p.name.includes(q) || String(p.id) === q || String(p.id).padStart(3, '0') === q);
  }

  if (activeTypeFilters.size > 0) {
    // type filtering requires knowing each pokemon's types -> use PokeAPI type endpoint (cached per type)
    filteredNames = null; // will resolve async below
    filterByTypes([...activeTypeFilters], list).then(res => {
      filteredNames = res;
      renderedCount = 0;
      listGrid.innerHTML = '';
      renderList(false);
    });
    searchCount.textContent = '…';
    return;
  }

  filteredNames = list;
  renderedCount = 0;
  listGrid.innerHTML = '';
  renderList(false);
}

async function filterByTypes(types, baseList) {
  // fetch (or read from cache) each type's pokemon name set, then intersect them
  const sets = await Promise.all(types.map(async (type) => {
    const cacheKey = `pkdx_type_${type}`;
    let names = store.get(cacheKey);
    if (!names) {
      const res = await fetch(`${API}/type/${type}`);
      const data = await res.json();
      names = data.pokemon.map(p => p.pokemon.name);
      store.set(cacheKey, names);
    }
    return new Set(names);
  }));

  return baseList.filter(p => sets.every(s => s.has(p.name)));
}

function renderList(append) {
  if (!filteredNames) return;
  searchCount.textContent = `${filteredNames.length}`;
  const slice = filteredNames.slice(renderedCount, renderedCount + PAGE_SIZE);
  slice.forEach(p => listGrid.appendChild(buildCard(p)));
  renderedCount += slice.length;
  loadMoreBtn.hidden = renderedCount >= filteredNames.length;
}

function buildCard(p) {
  const card = document.createElement('button');
  card.className = 'pk-card';
  card.dataset.name = p.name;
  const spriteId = p.id <= 1025 ? p.id : 1;
  card.innerHTML = `
    <img class="pk-card__img" loading="lazy" src="${SPRITE_BASE}/${spriteId}.png" alt="">
    <span>
      <span class="pk-card__id">#${String(p.id).padStart(3, '0')}</span>
      <span class="pk-card__name">${p.name}</span>
    </span>`;
  card.addEventListener('click', () => selectPokemon(p.name));
  return card;
}

function highlightSelectedCard() {
  [...listGrid.children].forEach(c => {
    c.classList.toggle('is-selected', currentData && c.dataset.name === currentData.name);
  });
}

/* ---------- selection / navigation ---------- */
async function selectPokemon(name) {
  screenEmpty.hidden = true;
  screenContent.hidden = false;
  screenContent.style.opacity = '0.5';

  const data = await fetchPokemon(name);
  currentData = data;
  showShiny = false;
  currentIndex = (filteredNames || allNames).findIndex(p => p.name === name);

  renderDetail(data);
  highlightSelectedCard();
  screenContent.style.opacity = '1';
}

function stepSelection(dir) {
  const list = filteredNames && filteredNames.length ? filteredNames : allNames;
  if (currentIndex < 0) return;
  let next = currentIndex + dir;
  if (next < 0) next = list.length - 1;
  if (next >= list.length) next = 0;
  selectPokemon(list[next].name);
}

/* ---------- data fetching ---------- */
async function fetchPokemon(name) {
  const cacheKey = `pkdx_pk_${name}`;
  if (detailCache.has(name)) return detailCache.get(name);
  let cached = store.get(cacheKey);
  if (cached) { detailCache.set(name, cached); return cached; }

  const [pkRes, spRes] = await Promise.all([
    fetch(`${API}/pokemon/${name}`),
    fetch(`${API}/pokemon-species/${name}`)
  ]);
  const pk = await pkRes.json();
  const sp = await spRes.json();

  const flavor = (sp.flavor_text_entries || []).find(f => f.language.name === 'fr')
              || (sp.flavor_text_entries || []).find(f => f.language.name === 'en');

  const result = {
    id: pk.id,
    name: pk.name,
    types: pk.types.map(t => t.type.name),
    stats: pk.stats.map(s => ({ key: s.stat.name, base: s.base_stat })),
    height: pk.height,
    weight: pk.weight,
    abilities: pk.abilities.map(a => ({ name: a.ability.name, hidden: a.is_hidden })),
    moves: pk.moves.map(m => ({
      name: m.move.name,
      levelUp: m.version_group_details.some(v => v.move_learn_method.name === 'level-up')
    })),
    speciesUrl: pk.species.url,
    evolutionChainUrl: sp.evolution_chain ? sp.evolution_chain.url : null,
    flavorText: flavor ? flavor.flavor_text.replace(/[\n\f\u000c]/g, ' ') : '',
    genus: (sp.genera || []).find(g => g.language.name === 'fr')?.genus
        || (sp.genera || []).find(g => g.language.name === 'en')?.genus || '',
    captureRate: sp.capture_rate,
    baseHappiness: sp.base_happiness,
    generation: sp.generation ? sp.generation.name : ''
  };

  detailCache.set(name, result);
  store.set(cacheKey, result);
  return result;
}

/* ---------- rendering: detail screen ---------- */
function renderDetail(data) {
  const mainType = data.types[0];
  document.documentElement.style.setProperty('--type-color', TYPE_COLORS[mainType] || '#e0483e');

  $('pkId').textContent = `#${String(data.id).padStart(3, '0')}`;
  $('pkName').textContent = data.name;
  $('shinyToggle').setAttribute('aria-pressed', 'false');

  renderSprite();

  $('pkTypes').innerHTML = data.types.map(t =>
    `<span class="type-badge" style="background:${TYPE_COLORS[t] || '#888'}">${t}</span>`
  ).join('');

  renderStats(data);
  renderEvolution(data);
  renderMoves(data);
  renderAbout(data);
}

function renderSprite() {
  const spriteId = currentData.id;
  const variant = showShiny ? 'shiny' : '';
  const path = variant ? `${SPRITE_BASE}/shiny/${spriteId}.png` : `${SPRITE_BASE}/${spriteId}.png`;
  const img = $('pkSprite');
  img.src = path;
  img.alt = `${currentData.name}${showShiny ? ' (chromatique)' : ''}`;
}

function toggleShiny() {
  showShiny = !showShiny;
  $('shinyToggle').setAttribute('aria-pressed', String(showShiny));
  renderSprite();
}

function renderStats(data) {
  const max = 255;
  const total = data.stats.reduce((s, x) => s + x.base, 0);
  $('statsList').innerHTML = data.stats.map(s => `
    <div class="stat-row">
      <span class="stat-row__label">${STAT_LABELS[s.key] || s.key}</span>
      <span class="stat-row__bar"><span class="stat-row__fill" style="width:0%;background:${statColor(s.base)}" data-width="${Math.min(100, s.base / max * 100)}"></span></span>
      <span class="stat-row__val">${s.base}</span>
    </div>`).join('') + `<div class="stats-total"><span>Total</span><span>${total}</span></div>`;

  // trigger the fill animation on next frame (from 0 to actual width)
  requestAnimationFrame(() => {
    document.querySelectorAll('.stat-row__fill').forEach(el => {
      el.style.width = el.dataset.width + '%';
    });
  });
}

/* stat value -> couleur : rouge (mauvais) -> vert (bon) -> bleu (excellent) */
const STAT_COLOR_STOPS = [
  [0,   [224, 72, 62]],   // rouge — mauvais
  [50,  [230, 126, 34]],  // orange — faible
  [80,  [241, 196, 15]],  // jaune — moyen
  [100, [111, 207, 87]],  // vert clair — bon
  [120, [39, 174, 96]],   // vert — très bon
  [150, [47, 128, 237]]   // bleu — excellent, digne des meilleurs
];

function statColor(value) {
  const v = Math.max(0, Math.min(150, value));
  let lo = STAT_COLOR_STOPS[0], hi = STAT_COLOR_STOPS[STAT_COLOR_STOPS.length - 1];
  for (let i = 0; i < STAT_COLOR_STOPS.length - 1; i++) {
    if (v >= STAT_COLOR_STOPS[i][0] && v <= STAT_COLOR_STOPS[i + 1][0]) {
      lo = STAT_COLOR_STOPS[i];
      hi = STAT_COLOR_STOPS[i + 1];
      break;
    }
  }
  const range = hi[0] - lo[0] || 1;
  const t = (v - lo[0]) / range;
  const r = Math.round(lo[1][0] + (hi[1][0] - lo[1][0]) * t);
  const g = Math.round(lo[1][1] + (hi[1][1] - lo[1][1]) * t);
  const b = Math.round(lo[1][2] + (hi[1][2] - lo[1][2]) * t);
  return `rgb(${r}, ${g}, ${b})`;
}

async function renderEvolution(data) {
  const evoEl = $('evoChain');
  evoEl.innerHTML = '<p class="hint">Chargement…</p>';
  if (!data.evolutionChainUrl) { evoEl.innerHTML = '<p class="hint">Pas de données d\'évolution.</p>'; return; }

  const chainKey = `pkdx_chain_${data.evolutionChainUrl}`;
  let chain = store.get(chainKey);
  if (!chain) {
    const res = await fetch(data.evolutionChainUrl);
    const json = await res.json();
    chain = flattenChain(json.chain);
    store.set(chainKey, chain);
  }

  // only re-render if this is still the selected pokemon
  if (!currentData || currentData.name !== data.name) return;

  evoEl.innerHTML = '';
  chain.forEach((step, i) => {
    if (i > 0) {
      const arrow = document.createElement('div');
      arrow.className = 'evo-arrow';
      arrow.innerHTML = `<span>→</span><span>${step.trigger || ''}</span>`;
      evoEl.appendChild(arrow);
    }
    const node = document.createElement('div');
    node.className = 'evo-node' + (step.name === data.name ? ' is-current' : '');
    node.innerHTML = `
      <img src="${SPRITE_BASE}/${step.id}.png" alt="${step.name}" loading="lazy">
      <span class="evo-node__name">${step.name}</span>`;
    node.addEventListener('click', () => selectPokemon(step.name));
    evoEl.appendChild(node);
  });
}

function flattenChain(node, trigger, acc = []) {
  const id = parseInt(node.species.url.split('/').filter(Boolean).pop(), 10);
  acc.push({ name: node.species.name, id, trigger });
  (node.evolves_to || []).forEach(next => {
    const details = next.evolution_details && next.evolution_details[0];
    let label = '';
    if (details) {
      if (details.min_level) label = `Nv. ${details.min_level}`;
      else if (details.item) label = details.item.name.replace(/-/g, ' ');
      else if (details.trigger && details.trigger.name === 'trade') label = 'Échange';
      else if (details.min_happiness) label = 'Bonheur';
      else label = details.trigger ? details.trigger.name.replace(/-/g, ' ') : '';
    }
    flattenChain(next, label, acc);
  });
  return acc;
}

async function renderMoves(data) {
  $('signatureMove').innerHTML = '<p class="hint">Analyse…</p>';
  $('movesList').innerHTML = data.moves.slice(0, 60).map(m =>
    `<span class="move-chip">${m.name.replace(/-/g, ' ')}</span>`
  ).join('');

  const levelUpMoves = data.moves.filter(m => m.levelUp).map(m => m.name).slice(0, 12);
  let bestMove = null;
  let bestCount = Infinity;

  for (const moveName of levelUpMoves) {
    const count = await learnerCount(moveName);
    if (count > 0 && count < bestCount) {
      bestCount = count;
      bestMove = moveName;
    }
    if (bestCount <= 1) break;
  }

  if (!currentData || currentData.name !== data.name) return;

  const sigEl = $('signatureMove');
  if (bestMove && bestCount <= 2) {
    sigEl.className = 'signature-move';
    sigEl.innerHTML = `
      <div class="signature-move__name">${bestMove.replace(/-/g, ' ')}</div>
      <div class="signature-move__meta">Apprise par ${bestCount} Pokémon seulement — probable attaque signature</div>`;
  } else {
    sigEl.className = 'signature-move is-none';
    sigEl.innerHTML = `Aucune attaque clairement exclusive détectée parmi les premières capacités apprises par niveau.`;
  }
}

async function learnerCount(moveName) {
  if (moveCache.has(moveName)) return moveCache.get(moveName);
  const cacheKey = `pkdx_move_${moveName}`;
  let cached = store.get(cacheKey);
  if (cached != null) { moveCache.set(moveName, cached); return cached; }
  try {
    const res = await fetch(`${API}/move/${moveName}`);
    const data = await res.json();
    const count = (data.learned_by_pokemon || []).length;
    moveCache.set(moveName, count);
    store.set(cacheKey, count);
    return count;
  } catch {
    return 0;
  }
}

function renderAbout(data) {
  const heightM = (data.height / 10).toFixed(1);
  const weightKg = (data.weight / 10).toFixed(1);
  const abilities = data.abilities.map(a => a.name.replace(/-/g, ' ') + (a.hidden ? ' (cachée)' : '')).join(', ');

  $('aboutGrid').innerHTML = `
    <div class="about-cell"><div class="about-cell__label">Taille</div><div class="about-cell__val">${heightM} m</div></div>
    <div class="about-cell"><div class="about-cell__label">Poids</div><div class="about-cell__val">${weightKg} kg</div></div>
    <div class="about-cell"><div class="about-cell__label">Talents</div><div class="about-cell__val">${abilities}</div></div>
    <div class="about-cell"><div class="about-cell__label">Génération</div><div class="about-cell__val">${(data.generation || '').replace('generation-', '')}</div></div>
    <div class="about-cell"><div class="about-cell__label">Taux de capture</div><div class="about-cell__val">${data.captureRate}</div></div>
    <div class="about-cell"><div class="about-cell__label">Bonheur de base</div><div class="about-cell__val">${data.baseHappiness}</div></div>
    <div class="about-cell" style="grid-column:1/-1"><div class="about-cell__label">${data.genus}</div><div class="about-cell__val" style="text-transform:none">${data.flavorText}</div></div>
  `;
}

/* ---------- tabs ---------- */
function selectTab(tab) {
  document.querySelectorAll('.tab').forEach(b => b.classList.toggle('is-active', b.dataset.tab === tab));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('is-active', p.id === `panel-${tab}`));
}
