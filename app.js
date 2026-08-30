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

/* ---------- cache (localStorage) ---------- */
const store = {
  get(key) {
    try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
  },
  set(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* quota: ignore */ }
  }
};

/* ---------- state ---------- */
let allNames = [];       // [{name, id}] full national dex list
let filteredNames = [];  // after search/type filter
let renderedCount = 0;
let currentIndex = -1;   // index into filteredNames of the selected pokemon
let currentData = null;
let showShiny = false;
let activeTypeFilters = new Set();
let team = new Set(store.get('pkdx_team_v1') || []);
let teamOnlyMode = false;
let compareOnlyMode = false;
const compareSlots = { A: null, B: null }; // données complètes (fetchPokemon) de chaque côté
let POKEMON_FR = {};   // id -> nom français
let TYPE_FR = {};      // slug -> nom français
let MOVE_FR = {};      // slug -> nom français
let ABILITY_FR = {};   // slug -> nom français
let ITEM_FR = {};      // slug -> nom français (pierres d'évolution, objets tenus…)
let ABILITY_DESC_FR = {}; // slug -> description détaillée en français (pas juste la ligne "flavor" du jeu)
let FORMS_FR = {};     // slug de forme (ex. "charizard-mega-x") -> { speciesId, name, isMega }
const detailCache = new Map();
const moveCache = new Map();

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
const teamPanel = $('teamPanel');
const teamToggle = $('teamToggle');
const comparePanel = $('comparePanel');
const compareToggle = $('compareToggle');

/* ---------- init ---------- */
init();

async function init() {
  buildTypeFilters();
  bindEvents();
  $('teamCount').textContent = `${team.size}/6`;
  await Promise.all([loadTranslations(), loadNameList()]);
  buildTypeFilters(); // rebuild with French labels once translations are ready
  applyFilters();
}

/* ---------- traductions françaises (fichiers statiques, chargés une seule fois) ---------- */
async function loadTranslations() {
  try {
    const [pk, ty, mv, ab, fo, it, abd] = await Promise.all([
      fetch('pokemon-fr.json').then(r => r.json()),
      fetch('type-fr.json').then(r => r.json()),
      fetch('move-fr.json').then(r => r.json()),
      fetch('ability-fr.json').then(r => r.json()),
      fetch('forms-fr.json').then(r => r.json()),
      fetch('item-fr.json').then(r => r.json()),
      fetch('ability-desc-fr.json').then(r => r.json())
    ]);
    POKEMON_FR = pk; TYPE_FR = ty; MOVE_FR = mv; ABILITY_FR = ab; FORMS_FR = fo; ITEM_FR = it; ABILITY_DESC_FR = abd;
  } catch {
    // pas grave : l'app retombe sur les noms anglais si les fichiers sont indisponibles
  }
}

/* nom d'affichage : gère aussi bien les Pokémon de base que leurs formes (Méga, régionales…) */
function displayName(data) {
  return FORMS_FR[data.name]?.name || pkNameFr(data.id, data.name);
}

function pkNameFr(id, fallbackEnName) {
  return POKEMON_FR[String(id)] || fallbackEnName;
}
function typeNameFr(slug) {
  return TYPE_FR[slug] || slug;
}
function moveNameFr(slug) {
  return MOVE_FR[slug] || slug.replace(/-/g, ' ');
}
function abilityNameFr(slug) {
  return ABILITY_FR[slug] || slug.replace(/-/g, ' ');
}
function itemNameFr(slug) {
  return ITEM_FR[slug] || slug.replace(/-/g, ' ');
}

/* accent-insensitive, pour que la recherche marche pareil en FR et EN */
function normalizeSearch(str) {
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function buildTypeFilters() {
  typeFilters.innerHTML = '';
  Object.keys(TYPE_COLORS).forEach((type) => {
    const chip = document.createElement('button');
    chip.className = 'filter-chip';
    chip.textContent = typeNameFr(type);
    chip.classList.toggle('is-active', activeTypeFilters.has(type));
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
  listGrid.addEventListener('scroll', debounce(maybeAutoLoadMore, 100));
  $('shinyToggle').addEventListener('click', toggleShiny);
  $('prevPk').addEventListener('click', () => stepSelection(-1));
  $('nextPk').addEventListener('click', () => stepSelection(1));
  $('teamStar').addEventListener('click', () => toggleTeamMember(currentData.name));
  $('cryBtn').addEventListener('click', playCry);
  teamToggle.addEventListener('click', () => {
    teamOnlyMode = !teamOnlyMode;
    teamToggle.setAttribute('aria-pressed', String(teamOnlyMode));
    teamToggle.classList.toggle('is-active', teamOnlyMode);
    teamPanel.hidden = !teamOnlyMode;
    if (teamOnlyMode) renderTeamPanel();
    applyFilters();
  });
  compareToggle.addEventListener('click', () => {
    compareOnlyMode = !compareOnlyMode;
    compareToggle.setAttribute('aria-pressed', String(compareOnlyMode));
    compareToggle.classList.toggle('is-active', compareOnlyMode);
    comparePanel.hidden = !compareOnlyMode;
  });
  $('compareSearchA').addEventListener('input', debounce(() => renderCompareResults('A'), 120));
  $('compareSearchB').addEventListener('input', debounce(() => renderCompareResults('B'), 120));
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
  const q = normalizeSearch(searchInput.value.trim());
  let list = allNames;
  let formMatches = [];

  if (q) {
    list = list.filter(p => {
      const frName = POKEMON_FR[String(p.id)];
      return p.name.includes(q)
        || (frName && normalizeSearch(frName).includes(q))
        || String(p.id) === q
        || String(p.id).padStart(3, '0') === q;
    });

    // la recherche inclut aussi les formes (Méga, Gigamax, régionales…), sauf si un autre filtre est actif
    if (!teamOnlyMode && activeTypeFilters.size === 0) {
      formMatches = getMatchingForms(q);
    }
  }

  if (teamOnlyMode) {
    list = list.filter(p => team.has(p.name));
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

  filteredNames = [...list, ...formMatches];
  renderedCount = 0;
  listGrid.innerHTML = '';
  renderList(false);
}

/* cherche parmi les formes alternatives (clé JSON = slug ; valeur = {id, speciesId, name, isMega}) */
function getMatchingForms(q, limit = Infinity) {
  return Object.keys(FORMS_FR)
    .filter(slug => normalizeSearch(slug).includes(q) || normalizeSearch(FORMS_FR[slug].name).includes(q))
    .slice(0, limit)
    .map(slug => {
      const f = FORMS_FR[slug];
      return { name: slug, id: f.id, dexId: f.speciesId, label: f.name, isForm: true };
    });
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
  // si la page ne remplit pas encore le cadre visible (donc pas de scroll possible), on charge la suite automatiquement
  requestAnimationFrame(maybeAutoLoadMore);
}

/* charge la page suivante automatiquement quand on approche du bas de la liste, sans avoir à cliquer */
function maybeAutoLoadMore() {
  if (!filteredNames || renderedCount >= filteredNames.length) return;
  const nearBottom = listGrid.scrollHeight - listGrid.scrollTop - listGrid.clientHeight < 200;
  const notScrollableYet = listGrid.scrollHeight <= listGrid.clientHeight;
  if (nearBottom || notScrollableYet) renderList(true);
}

function buildCard(p) {
  const card = document.createElement('button');
  card.className = 'pk-card' + (p.isForm ? ' pk-card--form' : '');
  card.dataset.name = p.name;
  const dexId = p.dexId || p.id;
  const label = p.label || pkNameFr(p.id, p.name);
  card.innerHTML = `
    <img class="pk-card__img" loading="lazy" src="${SPRITE_BASE}/${p.id}.png" alt="" onerror="this.onerror=null;this.src='icon-192.png';this.classList.add('is-fallback')">
    <span>
      <span class="pk-card__id">#${String(dexId).padStart(3, '0')}${p.isForm ? ' <em>forme</em>' : ''}</span>
      <span class="pk-card__name">${label}</span>
    </span>
    <span class="pk-card__star ${team.has(p.name) ? 'is-active' : ''}" data-star="${p.name}">★</span>`;
  card.addEventListener('click', (e) => {
    const star = e.target.closest('[data-star]');
    if (star) { e.stopPropagation(); toggleTeamMember(star.dataset.star); return; }
    selectPokemon(p.name);
  });
  return card;
}

function highlightSelectedCard() {
  [...listGrid.children].forEach(c => {
    c.classList.toggle('is-selected', currentData && c.dataset.name === currentData.name);
  });
}

/* ---------- team (favoris) ---------- */
function toggleTeamMember(name) {
  if (team.has(name)) {
    team.delete(name);
  } else {
    if (team.size >= 6) { setCacheStatus('équipe déjà pleine (6/6)'); return; }
    team.add(name);
  }
  store.set('pkdx_team_v1', [...team]);
  $('teamCount').textContent = `${team.size}/6`;

  // sync star states everywhere on screen
  document.querySelectorAll(`[data-star="${cssEscape(name)}"]`).forEach(s => s.classList.toggle('is-active', team.has(name)));
  if (currentData && currentData.name === name) {
    $('teamStar').setAttribute('aria-pressed', String(team.has(name)));
  }
  if (teamOnlyMode) { applyFilters(); renderTeamPanel(); }
  else if (teamPanel && !teamPanel.hidden) { renderTeamPanel(); }
}

function cssEscape(s) {
  return window.CSS && CSS.escape ? CSS.escape(s) : s.replace(/[^a-zA-Z0-9_-]/g, '\\$&');
}

async function renderTeamPanel() {
  $('teamCount').textContent = `${team.size}/6`;
  const membersEl = $('teamMembers');
  const weakEl = $('teamWeak');

  if (team.size === 0) {
    membersEl.innerHTML = '<p class="hint">Clique sur l\'étoile ★ d\'un Pokémon (dans la liste ou sa fiche) pour l\'ajouter à ton équipe.</p>';
    weakEl.innerHTML = '';
    return;
  }

  const names = [...team];
  const dataList = await Promise.all(names.map(n => fetchPokemon(n)));

  membersEl.innerHTML = dataList.map(d => `
    <div class="team-member">
      <img src="${SPRITE_BASE}/${d.id}.png" alt="${d.name}" loading="lazy" onerror="this.onerror=null;this.src='icon-192.png';this.classList.add('is-fallback')">
      <span class="team-member__name">${pkNameFr(d.id, d.name)}</span>
      <button class="team-member__remove" data-star="${d.name}" title="Retirer">✕</button>
    </div>`).join('');

  membersEl.querySelectorAll('[data-star]').forEach(btn =>
    btn.addEventListener('click', () => toggleTeamMember(btn.dataset.star))
  );

  // combined weaknesses: for each attacking type, count how many team members take x2+ damage
  const relationsPerPokemon = await Promise.all(
    dataList.map(d => Promise.all(d.types.map(t => getTypeDamageRelations(t))))
  );

  const counts = ALL_TYPES.map(atk => {
    let weakCount = 0;
    relationsPerPokemon.forEach(relList => {
      let mult = 1;
      relList.forEach(rel => {
        if (rel.zero.includes(atk)) mult *= 0;
        else if (rel.double.includes(atk)) mult *= 2;
        else if (rel.half.includes(atk)) mult *= 0.5;
      });
      if (mult >= 2) weakCount++;
    });
    return { type: atk, weakCount };
  }).filter(r => r.weakCount > 0).sort((a, b) => b.weakCount - a.weakCount);

  weakEl.innerHTML = counts.length ? `
    <span class="team-panel__weak-title">Faiblesses partagées par l'équipe</span>
    <div class="team-panel__weak-grid">
      ${counts.map(c => `
        <span class="type-chip ${c.weakCount >= 2 ? 'is-danger' : ''}" style="background:${TYPE_COLORS[c.type]}">
          ${typeNameFr(c.type)} <b>${c.weakCount}/${dataList.length}</b>
        </span>`).join('')}
    </div>` : '<p class="hint">Aucune faiblesse commune détectée pour l\'instant.</p>';
}

/* ---------- comparateur (accepte aussi bien les Pokémon de base que leurs formes) ---------- */
function renderCompareResults(slotKey) {
  const input = $(`compareSearch${slotKey}`);
  const resultsEl = $(`compareResults${slotKey}`);
  const q = normalizeSearch(input.value.trim());

  if (!q) { resultsEl.innerHTML = ''; resultsEl.hidden = true; return; }

  const baseMatches = allNames
    .filter(p => {
      const frName = POKEMON_FR[String(p.id)];
      return p.name.includes(q) || (frName && normalizeSearch(frName).includes(q)) || String(p.id) === q;
    })
    .slice(0, 6)
    .map(p => ({ name: p.name, id: p.id, dexId: p.id, label: pkNameFr(p.id, p.name), isForm: false }));

  const formMatches = getMatchingForms(q, 6);
  const combined = [...baseMatches, ...formMatches].slice(0, 8);

  if (!combined.length) {
    resultsEl.innerHTML = '<p class="hint">Aucun résultat.</p>';
    resultsEl.hidden = false;
    return;
  }

  resultsEl.innerHTML = combined.map(p => `
    <button class="compare-result" data-slug="${p.name}">
      <img src="${SPRITE_BASE}/${p.id}.png" alt="" loading="lazy" onerror="this.onerror=null;this.src='icon-192.png';this.classList.add('is-fallback')">
      <span>${p.label}${p.isForm ? ' <em>forme</em>' : ''}</span>
    </button>`).join('');
  resultsEl.hidden = false;
  resultsEl.querySelectorAll('.compare-result').forEach(btn =>
    btn.addEventListener('click', () => pickCompareSlot(slotKey, btn.dataset.slug))
  );
}

async function pickCompareSlot(slotKey, slug) {
  const data = await fetchPokemon(slug);
  compareSlots[slotKey] = data;

  const searchWrap = document.querySelector(`#compareSlot${slotKey} .compare-slot__search`);
  const pickedEl = $(`comparePicked${slotKey}`);
  searchWrap.hidden = true;
  pickedEl.hidden = false;
  pickedEl.innerHTML = `
    <img src="${SPRITE_BASE}/${data.id}.png" alt="${displayName(data)}" onerror="this.onerror=null;this.src='icon-192.png';this.classList.add('is-fallback')">
    <span class="compare-slot__name">${displayName(data)}</span>
    <span class="type-badges">${data.types.map(t => `<span class="type-badge" style="background:${TYPE_COLORS[t] || '#888'}">${typeNameFr(t)}</span>`).join('')}</span>
    <button class="compare-slot__reset" data-slot="${slotKey}">Changer</button>`;
  pickedEl.querySelector('.compare-slot__reset').addEventListener('click', () => resetCompareSlot(slotKey));

  renderCompareTable();
}

function resetCompareSlot(slotKey) {
  compareSlots[slotKey] = null;
  const searchWrap = document.querySelector(`#compareSlot${slotKey} .compare-slot__search`);
  const pickedEl = $(`comparePicked${slotKey}`);
  const input = $(`compareSearch${slotKey}`);
  searchWrap.hidden = false;
  pickedEl.hidden = true;
  pickedEl.innerHTML = '';
  input.value = '';
  $(`compareResults${slotKey}`).innerHTML = '';
  renderCompareTable();
}

async function renderCompareTable() {
  const tableEl = $('compareTable');
  const a = compareSlots.A, b = compareSlots.B;

  if (!a || !b) {
    tableEl.innerHTML = '<p class="hint">Choisis un Pokémon (ou une forme) dans chaque colonne pour lancer la comparaison.</p>';
    return;
  }

  const rows = a.stats.map((s, i) => {
    const bVal = b.stats[i].base;
    return {
      label: STAT_LABELS[s.key] || s.key,
      aVal: s.base,
      bVal,
      aWins: s.base > bVal,
      bWins: bVal > s.base
    };
  });
  const aTotal = a.stats.reduce((s, x) => s + x.base, 0);
  const bTotal = b.stats.reduce((s, x) => s + x.base, 0);

  tableEl.innerHTML = `
    <div class="compare-row compare-row--head">
      <span class="${aTotal > bTotal ? 'is-winner' : ''}">${displayName(a)}</span>
      <span></span>
      <span class="${bTotal > aTotal ? 'is-winner' : ''}">${displayName(b)}</span>
    </div>
    ${rows.map(r => `
      <div class="compare-row">
        <span class="${r.aWins ? 'is-winner' : ''}">${r.aVal}</span>
        <span class="compare-row__label">${r.label}</span>
        <span class="${r.bWins ? 'is-winner' : ''}">${r.bVal}</span>
      </div>`).join('')}
    <div class="compare-row compare-row--total">
      <span class="${aTotal > bTotal ? 'is-winner' : ''}">${aTotal}</span>
      <span class="compare-row__label">Total</span>
      <span class="${bTotal > aTotal ? 'is-winner' : ''}">${bTotal}</span>
    </div>
    <div class="compare-weak" id="compareWeak"><p class="hint">Calcul des faiblesses…</p></div>`;

  // toujours reconfirmer qu'on compare encore les mêmes deux Pokémon une fois la promesse résolue
  const [relA, relB] = await Promise.all([
    Promise.all(a.types.map(t => getTypeDamageRelations(t))),
    Promise.all(b.types.map(t => getTypeDamageRelations(t)))
  ]);
  if (compareSlots.A !== a || compareSlots.B !== b) return;

  const weakA = weaknessesFrom(relA);
  const weakB = weaknessesFrom(relB);
  const sharedTypes = new Set(weakA.filter(w => weakB.some(x => x.type === w.type)).map(w => w.type));

  const weakChip = (w, shared) => `
    <span class="type-chip ${shared ? 'is-danger' : ''}" style="background:${TYPE_COLORS[w.type]}">
      ${typeNameFr(w.type)} <b>×${w.mult}</b>
    </span>`;

  $('compareWeak').innerHTML = `
    <div class="compare-weak__title">Faiblesses (×2 ou plus) ${sharedTypes.size ? '— types en commun entourés en rouge' : ''}</div>
    <div class="compare-weak__cols">
      <div class="compare-weak__col">${weakA.length ? weakA.map(w => weakChip(w, sharedTypes.has(w.type))).join('') : '<span class="hint">Aucune</span>'}</div>
      <div class="compare-weak__col">${weakB.length ? weakB.map(w => weakChip(w, sharedTypes.has(w.type))).join('') : '<span class="hint">Aucune</span>'}</div>
    </div>`;
}

function weaknessesFrom(relList) {
  return ALL_TYPES.map(atk => {
    let mult = 1;
    relList.forEach(rel => {
      if (rel.zero.includes(atk)) mult *= 0;
      else if (rel.double.includes(atk)) mult *= 2;
      else if (rel.half.includes(atk)) mult *= 0.5;
    });
    return { type: atk, mult };
  }).filter(r => r.mult >= 2).sort((x, y) => y.mult - x.mult);
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

  const pkRes = await fetch(`${API}/pokemon/${name}`);
  const pk = await pkRes.json();
  // pk.species.url pointe toujours vers la bonne espèce de base, même pour une forme (Méga, régionale…)
  const spRes = await fetch(pk.species.url);
  const sp = await spRes.json();

  const flavor = (sp.flavor_text_entries || []).find(f => f.language.name === 'fr')
              || (sp.flavor_text_entries || []).find(f => f.language.name === 'en');

  const result = {
    id: pk.id,
    name: pk.name,
    speciesId: sp.id,
    cryUrl: pk.cries ? pk.cries.latest : null,
    types: pk.types.map(t => t.type.name),
    stats: pk.stats.map(s => ({ key: s.stat.name, base: s.base_stat })),
    height: pk.height,
    weight: pk.weight,
    abilities: pk.abilities.map(a => ({ name: a.ability.name, hidden: a.is_hidden })),
    moves: pk.moves.map(m => {
      const levelUpDetails = m.version_group_details.filter(v => v.move_learn_method.name === 'level-up');
      return {
        name: m.move.name,
        levelUp: levelUpDetails.length > 0,
        level: levelUpDetails.length ? Math.min(...levelUpDetails.map(v => v.level_learned_at)) : null
      };
    }),
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
  $('pkName').textContent = displayName(data);
  $('shinyToggle').setAttribute('aria-pressed', 'false');
  $('teamStar').setAttribute('aria-pressed', String(team.has(data.name)));

  renderSprite();
  $('cryBtn').hidden = !data.cryUrl;

  $('pkTypes').innerHTML = data.types.map(t =>
    `<span class="type-badge" style="background:${TYPE_COLORS[t] || '#888'}">${typeNameFr(t)}</span>`
  ).join('');

  renderForms(data);

  renderStats(data);
  renderTypeChart(data);
  renderEvolution(data);
  renderMoves(data);
  renderAbout(data);
}

function renderSprite() {
  const spriteId = currentData.id;
  const variant = showShiny ? 'shiny' : '';
  const path = variant ? `${SPRITE_BASE}/shiny/${spriteId}.png` : `${SPRITE_BASE}/${spriteId}.png`;
  const img = $('pkSprite');
  img.classList.remove('is-fallback');
  img.onerror = () => {
    img.onerror = null;
    // repli : si le shiny n'existe pas, on retombe sur le sprite normal ; sinon sur l'icône générique
    if (variant) { img.src = `${SPRITE_BASE}/${spriteId}.png`; }
    else { img.src = 'icon-192.png'; img.classList.add('is-fallback'); }
  };
  img.src = path;
  img.alt = `${displayName(currentData)}${showShiny ? ' (chromatique)' : ''}`;
}

let cryAudio = null;
function playCry() {
  if (!currentData || !currentData.cryUrl) return;
  if (cryAudio) { cryAudio.pause(); cryAudio.currentTime = 0; }
  cryAudio = new Audio(currentData.cryUrl);
  cryAudio.volume = 0.6;
  cryAudio.play().catch(() => {}); // ignore si le navigateur bloque la lecture auto
}

function toggleShiny() {
  showShiny = !showShiny;
  $('shinyToggle').setAttribute('aria-pressed', String(showShiny));
  renderSprite();
}

/* ---------- formes alternatives (Méga, Gigamax, régionales…) ---------- */
function renderForms(data) {
  const row = $('formsRow');
  const speciesId = FORMS_FR[data.name]?.speciesId || data.speciesId || data.id;
  const baseEntry = allNames.find(p => p.id === speciesId);
  const baseSlug = baseEntry ? baseEntry.name : data.name;

  const altSlugs = Object.keys(FORMS_FR).filter(slug => FORMS_FR[slug].speciesId === speciesId);

  if (altSlugs.length === 0) {
    row.hidden = true;
    row.innerHTML = '';
    return;
  }

  const chips = [
    { slug: baseSlug, label: pkNameFr(speciesId, baseSlug) },
    ...altSlugs.map(slug => ({ slug, label: FORMS_FR[slug].name }))
  ];

  row.hidden = false;
  row.innerHTML = chips.map(c => `
    <button class="form-chip ${c.slug === data.name ? 'is-active' : ''}" data-form="${c.slug}">${c.label}</button>
  `).join('');
  row.querySelectorAll('.form-chip').forEach(btn =>
    btn.addEventListener('click', () => selectForm(btn.dataset.form))
  );
}

async function selectForm(slug) {
  if (currentData && currentData.name === slug) return;
  screenContent.style.opacity = '0.5';
  const data = await fetchPokemon(slug);
  currentData = data;
  showShiny = false;
  renderDetail(data);
  screenContent.style.opacity = '1';
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

  $('statsAbilities').innerHTML = data.abilities.map(a => `
    <button class="ability-chip ${a.hidden ? 'is-hidden' : ''}" data-ability="${a.name}">
      ${abilityNameFr(a.name)}${a.hidden ? ' <em>(cachée)</em>' : ''}
    </button>`).join('');
  $('abilityDetail').hidden = true;
  $('statsAbilities').querySelectorAll('.ability-chip').forEach(chip =>
    chip.addEventListener('click', () => onAbilityChipClick(chip.dataset.ability, chip))
  );
}

async function getAbilityDetails(slug) {
  // description détaillée en français, tirée des données officielles du jeu (bien plus complète que le "flavor text")
  if (ABILITY_DESC_FR[slug]) return { description: ABILITY_DESC_FR[slug] };

  // repli si le talent n'a pas de description FR dans notre base (rare, talents très récents)
  const cacheKey = `pkdx_ability_${slug}`;
  const cached = store.get(cacheKey);
  if (cached) return cached;
  const res = await fetch(`${API}/ability/${slug}`);
  const data = await res.json();
  const flavor = (data.flavor_text_entries || []).find(f => f.language.name === 'fr')
              || (data.flavor_text_entries || []).find(f => f.language.name === 'en');
  const description = flavor ? flavor.flavor_text.replace(/[\n\f\u000c]/g, ' ') : 'Pas de description disponible.';
  const result = { description };
  store.set(cacheKey, result);
  return result;
}

async function onAbilityChipClick(slug, chipEl) {
  document.querySelectorAll('#statsAbilities .ability-chip').forEach(c => c.classList.remove('is-active'));
  chipEl.classList.add('is-active', 'is-loading');
  const box = $('abilityDetail');
  box.hidden = false;
  box.innerHTML = '<p class="hint">Chargement…</p>';
  const detail = await getAbilityDetails(slug);
  chipEl.classList.remove('is-loading');
  box.innerHTML = `
    <div class="ability-detail__name">${abilityNameFr(slug)}</div>
    <p class="ability-detail__desc">${detail.description}</p>`;
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

const ALL_TYPES = Object.keys(TYPE_COLORS);

/* récupère (et met en cache) les relations de dégâts d'un type défenseur */
async function getTypeDamageRelations(type) {
  const cacheKey = `pkdx_typedmg_${type}`;
  const cached = store.get(cacheKey);
  if (cached) return cached;
  const res = await fetch(`${API}/type/${type}`);
  const data = await res.json();
  const rel = {
    double: data.damage_relations.double_damage_from.map(t => t.name), // reçoit x2 de ces types
    half: data.damage_relations.half_damage_from.map(t => t.name),     // reçoit x0.5
    zero: data.damage_relations.no_damage_from.map(t => t.name)        // immunisé
  };
  store.set(cacheKey, rel);
  return rel;
}

async function renderTypeChart(data) {
  const chartEl = $('typeChart');
  chartEl.innerHTML = '<p class="hint">Calcul des faiblesses…</p>';

  // une relation par type du Pokémon (1 ou 2), puis on multiplie les deux entre elles
  const relationsPerDefType = await Promise.all(data.types.map(t => getTypeDamageRelations(t)));

  if (!currentData || currentData.name !== data.name) return;

  const results = ALL_TYPES.map(atk => {
    let mult = 1;
    relationsPerDefType.forEach(rel => {
      if (rel.zero.includes(atk)) mult *= 0;
      else if (rel.double.includes(atk)) mult *= 2;
      else if (rel.half.includes(atk)) mult *= 0.5;
    });
    return { type: atk, mult };
  });

  const GROUPS = [
    { mult: 4,    label: 'Très faible ×4' },
    { mult: 2,    label: 'Faible ×2' },
    { mult: 1,    label: 'Neutre ×1' },
    { mult: 0.5,  label: 'Résiste ×0.5' },
    { mult: 0.25, label: 'Résiste beaucoup ×0.25' },
    { mult: 0,    label: 'Immunisé ×0' }
  ];

  const groupsHtml = GROUPS.map(g => {
    const items = results.filter(r => r.mult === g.mult);
    if (!items.length) return '';
    return `
      <div class="type-group type-group--${multClass(g.mult)}">
        <span class="type-group__label">${g.label}</span>
        <div class="type-group__chips">
          ${items.map(r => `<span class="type-chip" style="background:${TYPE_COLORS[r.type]}">${typeNameFr(r.type)}</span>`).join('')}
        </div>
      </div>`;
  }).join('');

  chartEl.innerHTML = `
    <h3 class="type-chart__title">Faiblesses &amp; résistances</h3>
    ${groupsHtml}`;
}

function multClass(m) {
  if (m === 0) return 'is-immune';
  if (m >= 4) return 'is-veryweak';
  if (m === 2) return 'is-weak';
  if (m === 1) return 'is-neutral';
  if (m === 0.5) return 'is-resist';
  return 'is-veryresist'; // 0.25
}

function formatMult(m) {
  const s = m.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
  return `×${s === '' ? '0' : s}`;
}

async function renderEvolution(data) {
  const evoEl = $('evoChain');
  evoEl.innerHTML = '<p class="hint">Chargement…</p>';
  if (!data.evolutionChainUrl) { evoEl.innerHTML = '<p class="hint">Pas de données d\'évolution.</p>'; return; }

  const chainKey = `pkdx_chain_v2_${data.evolutionChainUrl}`;
  let tree = store.get(chainKey);
  if (!tree) {
    const res = await fetch(data.evolutionChainUrl);
    const json = await res.json();
    tree = buildEvoTree(json.chain, null);
    store.set(chainKey, tree);
  }

  // only re-render if this is still the selected pokemon
  if (!currentData || currentData.name !== data.name) return;

  evoEl.innerHTML = '';
  evoEl.appendChild(renderEvoNode(tree, data.name));
}

/* construit un arbre (et pas une simple liste à plat) pour bien représenter les évolutions multiples */
function buildEvoTree(node, trigger) {
  const id = parseInt(node.species.url.split('/').filter(Boolean).pop(), 10);
  return {
    name: node.species.name,
    id,
    trigger: trigger || '',
    children: (node.evolves_to || []).map(next => {
      const details = next.evolution_details && next.evolution_details[0];
      let label = '';
      if (details) {
        if (details.min_level) label = `Nv. ${details.min_level}`;
        else if (details.item) label = itemNameFr(details.item.name);
        else if (details.trigger && details.trigger.name === 'trade') label = 'Échange';
        else if (details.min_happiness) label = 'Bonheur';
        else label = details.trigger ? details.trigger.name.replace(/-/g, ' ') : '';
      }
      return buildEvoTree(next, label);
    })
  };
}

/* rendu récursif : un nœud, et s'il a plusieurs évolutions possibles, elles sont empilées verticalement à sa droite */
function renderEvoNode(node, currentName) {
  const row = document.createElement('div');
  row.className = 'evo-tree-row';

  const chip = document.createElement('div');
  chip.className = 'evo-node' + (node.name === currentName ? ' is-current' : '');
  chip.innerHTML = `
    <img src="${SPRITE_BASE}/${node.id}.png" alt="${node.name}" loading="lazy" onerror="this.onerror=null;this.src='icon-192.png';this.classList.add('is-fallback')">
    <span class="evo-node__name">${pkNameFr(node.id, node.name)}</span>`;
  chip.addEventListener('click', () => selectPokemon(node.name));
  row.appendChild(chip);

  if (node.children.length) {
    const branches = document.createElement('div');
    branches.className = 'evo-branches' + (node.children.length > 1 ? ' has-multiple' : '');
    node.children.forEach(child => {
      const item = document.createElement('div');
      item.className = 'evo-branch-item';
      const arrow = document.createElement('div');
      arrow.className = 'evo-arrow';
      arrow.innerHTML = `<span>→</span><span>${child.trigger}</span>`;
      item.appendChild(arrow);
      item.appendChild(renderEvoNode(child, currentName));
      branches.appendChild(item);
    });
    row.appendChild(branches);
  }

  return row;
}

async function renderMoves(data) {
  $('signatureMove').innerHTML = '<p class="hint">Analyse…</p>';
  $('moveDetail').hidden = true;

  // ordre d'apprentissage : d'abord les attaques par niveau (croissant), puis le reste (CT, œuf…) par ordre alphabétique
  const sortedMoves = [...data.moves].sort((a, b) => {
    if (a.levelUp && b.levelUp) return (a.level ?? 0) - (b.level ?? 0);
    if (a.levelUp) return -1;
    if (b.levelUp) return 1;
    return a.name.localeCompare(b.name);
  });
  const moveSlice = sortedMoves.slice(0, 80);

  $('movesList').innerHTML = moveSlice.map(m => `
    <button class="move-chip" data-move="${m.name}">
      ${m.levelUp ? `<span class="move-chip__level">Nv.${m.level}</span>` : ''}${moveNameFr(m.name)}
    </button>`).join('');
  $('movesList').querySelectorAll('.move-chip').forEach(chip =>
    chip.addEventListener('click', () => onMoveChipClick(chip.dataset.move, chip))
  );

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
      <div class="signature-move__name">${moveNameFr(bestMove)}</div>
      <div class="signature-move__meta">Apprise par ${bestCount} Pokémon seulement — probable attaque signature</div>`;
  } else {
    sigEl.className = 'signature-move is-none';
    sigEl.innerHTML = `Aucune attaque clairement exclusive détectée parmi les premières capacités apprises par niveau.`;
  }
}

const DAMAGE_CLASS_FR = { physical: 'Physique', special: 'Spéciale', status: 'Statut' };

async function getMoveDetails(moveName) {
  const cacheKey = `pkdx_movedetail_${moveName}`;
  const cached = store.get(cacheKey);
  if (cached) return cached;
  const res = await fetch(`${API}/move/${moveName}`);
  const data = await res.json();
  const result = {
    name: data.name,
    type: data.type.name,
    power: data.power,
    accuracy: data.accuracy,
    pp: data.pp,
    damageClass: data.damage_class ? data.damage_class.name : ''
  };
  store.set(cacheKey, result);
  return result;
}

async function onMoveChipClick(moveName, chipEl) {
  // réinitialise toutes les pastilles (couleur + état actif) avant d'appliquer la nouvelle sélection
  document.querySelectorAll('#movesList .move-chip').forEach(c => {
    c.classList.remove('is-active');
    c.style.background = '';
  });
  chipEl.classList.add('is-active', 'is-loading');
  const detail = await getMoveDetails(moveName);
  chipEl.classList.remove('is-loading');
  chipEl.style.background = TYPE_COLORS[detail.type] || '';

  const box = $('moveDetail');
  box.hidden = false;
  box.innerHTML = `
    <div class="move-detail__head">
      <span class="move-detail__name">${moveNameFr(detail.name)}</span>
      <span class="type-badge" style="background:${TYPE_COLORS[detail.type] || '#888'}">${typeNameFr(detail.type)}</span>
    </div>
    <div class="move-detail__stats">
      <div><span>Puissance</span><b>${detail.power ?? '—'}</b></div>
      <div><span>Précision</span><b>${detail.accuracy != null ? detail.accuracy + '%' : '—'}</b></div>
      <div><span>PP</span><b>${detail.pp ?? '—'}</b></div>
      <div><span>Catégorie</span><b>${DAMAGE_CLASS_FR[detail.damageClass] || detail.damageClass || '—'}</b></div>
    </div>`;
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
  const abilities = data.abilities.map(a => abilityNameFr(a.name) + (a.hidden ? ' (cachée)' : '')).join(', ');

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
