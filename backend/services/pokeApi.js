// Fetching and filtering logic for PokeAPI. Every public function returns a small,
// trimmed object meant for an LLM's context, never raw API JSON.

import cache from '../utils/cache.js';

const BASE_URL = 'https://pokeapi.co/api/v2';
const AUTO_FIX_RATIO = 0.85; // fuzzy matches at least this similar are used without asking
const SUGGEST_CUTOFF = 0.6; // weaker matches are only offered as suggestions

export class NotFoundError extends Error {
  constructor(message) {
    super(message);
    this.name = 'NotFoundError';
  }
}

// ---------- fetching & caching ----------

async function fetchJson(pathOrUrl) {
  const url = pathOrUrl.startsWith('http') ? pathOrUrl : `${BASE_URL}/${pathOrUrl.replace(/^\/+|\/+$/g, '')}`;
  const res = await fetch(url);
  if (res.status === 404) throw new NotFoundError(`not found: ${url}`);
  if (!res.ok) throw new Error(`PokeAPI returned ${res.status} for ${url}`);
  return res.json();
}

// Check the cache first; otherwise run load() and cache its (filtered) result.
// The promise itself is cached so parallel calls share one request; failures are not cached.
function cached(key, load) {
  const hit = cache.get(key);
  if (hit) return hit;
  const promise = load().catch((err) => {
    cache.del(key);
    throw err;
  });
  cache.set(key, promise);
  return promise;
}

// ---------- fuzzy matching (port of Python's difflib, which the original bot used) ----------

function longestMatch(a, b, alo, ahi, blo, bhi) {
  let besti = alo, bestj = blo, bestsize = 0;
  let prev = new Map();
  for (let i = alo; i < ahi; i++) {
    const next = new Map();
    for (let j = blo; j < bhi; j++) {
      if (a[i] !== b[j]) continue;
      const k = (prev.get(j - 1) || 0) + 1;
      next.set(j, k);
      if (k > bestsize) [besti, bestj, bestsize] = [i - k + 1, j - k + 1, k];
    }
    prev = next;
  }
  return [besti, bestj, bestsize];
}

function matchingChars(a, b, alo, ahi, blo, bhi) {
  const [i, j, k] = longestMatch(a, b, alo, ahi, blo, bhi);
  if (!k) return 0;
  return k + matchingChars(a, b, alo, i, blo, j) + matchingChars(a, b, i + k, ahi, j + k, bhi);
}

/** Ratcliff/Obershelp similarity in [0, 1], same as difflib.SequenceMatcher.ratio(). */
export function similarity(a, b) {
  const total = a.length + b.length;
  return total ? (2 * matchingChars(a, b, 0, a.length, 0, b.length)) / total : 1;
}

// Cheap upper bound on similarity() used to skip hopeless candidates.
function quickRatio(a, b) {
  const counts = {};
  for (const c of b) counts[c] = (counts[c] || 0) + 1;
  let m = 0;
  for (const c of a) if (counts[c] > 0) counts[c]--, m++;
  return (2 * m) / (a.length + b.length);
}

function closeMatches(word, candidates, n = 3, cutoff = SUGGEST_CUTOFF) {
  const scored = [];
  for (const x of candidates) {
    if (quickRatio(x, word) < cutoff) continue;
    const score = similarity(x, word);
    if (score >= cutoff) scored.push([score, x]);
  }
  scored.sort((p, q) => q[0] - p[0] || (q[1] > p[1] ? 1 : q[1] < p[1] ? -1 : 0));
  return scored.slice(0, n).map(([, x]) => x);
}

// ---------- name resolution ----------

/** "Mr. Mime" -> "mr-mime", "Farfetch'd" -> "farfetchd". */
export function normalize(name) {
  return String(name)
    .toLowerCase()
    .trim()
    .replace(/[ .]/g, '-')
    .replace(/['’]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function nameIndex(resource) {
  return cached(`names:${resource}`, async () => {
    const list = (await fetchJson(`${resource}?limit=100000`)).results.map((r) => r.name);
    return { list, set: new Set(list) };
  });
}

function defaultVariety(species) {
  return cached(`default-variety:${species}`, async () => {
    const data = await fetchJson(`pokemon-species/${species}`);
    return data.varieties.find((v) => v.is_default).pokemon.name;
  });
}

/** Returns [apiName, matchedFrom]. matchedFrom is the user's input if it was auto-corrected. */
export async function resolve(resource, name) {
  const n = normalize(name);
  const names = await nameIndex(resource);
  if (names.set.has(n)) return [n, null];

  // Base names like "giratina" are species; the pokemon is "giratina-altered".
  const species = resource === 'pokemon' ? await nameIndex('pokemon-species') : null;
  if (species?.set.has(n)) return [await defaultVariety(n), null];

  const candidates = species ? [...names.list, ...species.list.filter((s) => !names.set.has(s))] : names.list;
  const matches = n ? closeMatches(n, candidates) : [];
  if (matches.length && similarity(n, matches[0]) >= AUTO_FIX_RATIO) {
    const best = matches[0];
    return [names.set.has(best) ? best : await defaultVariety(best), name];
  }

  const label = resource.replace('-', ' ');
  if (matches.length) throw new NotFoundError(`no ${label} '${name}', did you mean: ${matches.join(', ')}?`);
  throw new NotFoundError(`no ${label} '${name}' found`);
}

// Cached objects are shared, so add matched_from on a copy.
function withMatch(result, matchedFrom) {
  return matchedFrom ? { ...result, matched_from: matchedFrom } : result;
}

// ---------- text helpers ----------

/** Field of the latest English entry, or null. */
function english(entries, field) {
  const en = entries.filter((e) => e.language.name === 'en');
  return en.length ? en[en.length - 1][field] : null;
}

function clean(text) {
  if (text == null) return null;
  return text.replace(/[\f\n­]/g, ' ').split(/\s+/).filter(Boolean).join(' ');
}

/** English short_effect with $effect_chance filled in, else the latest English flavor text. */
function effectText(data) {
  const effect = english(data.effect_entries, 'short_effect');
  if (effect == null) return clean(english(data.flavor_text_entries, 'flavor_text'));
  return clean(data.effect_chance != null ? effect.replaceAll('$effect_chance', String(data.effect_chance)) : effect);
}

// ---------- filtered pieces ----------

const MATCHUP_LABELS = new Map([[4, '4x'], [2, '2x'], [0.5, '0.5x'], [0.25, '0.25x'], [0, '0x']]);

function typeRelations(type) {
  return cached(`type:${type}`, async () => {
    const rel = (await fetchJson(`type/${type}`)).damage_relations;
    const names = (key) => rel[key].map((t) => t.name);
    return { double: names('double_damage_from'), half: names('half_damage_from'), none: names('no_damage_from') };
  });
}

/** Damage taken from each attacking type, with both of a dual type's multipliers combined. */
async function typeMatchups(types) {
  const mult = {};
  for (const rel of await Promise.all(types.map(typeRelations))) {
    for (const [factor, list] of [[2, rel.double], [0.5, rel.half], [0, rel.none]]) {
      for (const atk of list) mult[atk] = (mult[atk] ?? 1) * factor;
    }
  }
  const result = { '4x': [], '2x': [], '0.5x': [], '0.25x': [], '0x': [] };
  for (const atk of Object.keys(mult).sort()) {
    const label = MATCHUP_LABELS.get(mult[atk]);
    if (label) result[label].push(atk);
  }
  return result; // types not listed take 1x
}

// Bookkeeping fields that repeat on every entry and don't help answer questions.
const EVO_NOISE = new Set(['version_group', 'is_default', 'required_pokemon_form']);

/** Keep only meaningful fields. 0 is kept (Tyrogue uses relative_physical_stats: 0). */
function evoCondition(details) {
  const cond = {};
  for (const [key, val] of Object.entries(details)) {
    if (EVO_NOISE.has(key) || val == null || val === false || val === '') continue;
    if (Array.isArray(val) && val.length === 0) continue;
    cond[key] = val && typeof val === 'object' && 'name' in val ? val.name : val;
  }
  return cond;
}

/** Flattens a (possibly branching) evolution tree into a list of from -> to steps. */
function evolutionChain(url) {
  return cached(`evolution:${url}`, async () => {
    const steps = [];
    const walk = (node) => {
      for (const next of node.evolves_to) {
        const conditions = [];
        for (const d of next.evolution_details) {
          const c = evoCondition(d);
          if (!conditions.some((x) => JSON.stringify(x) === JSON.stringify(c))) conditions.push(c);
        }
        steps.push({ from: node.species.name, to: next.species.name, conditions });
        walk(next);
      }
    };
    walk((await fetchJson(url)).chain);
    return steps; // empty means the Pokémon doesn't evolve
  });
}

// ---------- public functions ----------

/**
 * Everything about one Pokémon: types, base stats, abilities, size, species info,
 * defensive type matchups and evolution chain. Sprites, moves, game indices and
 * other bulky fields are stripped out.
 */
export async function getPokemonData(name) {
  const [apiName, matchedFrom] = await resolve('pokemon', name);
  const data = await cached(`pokemon:${apiName}`, async () => {
    const p = await fetchJson(`pokemon/${apiName}`);
    const types = p.types.map((t) => t.type.name);
    const [s, matchups] = await Promise.all([fetchJson(p.species.url), typeMatchups(types)]);
    return {
      name: p.name,
      id: p.id,
      types,
      stats: Object.fromEntries(p.stats.map((st) => [st.stat.name, st.base_stat])),
      abilities: p.abilities.map((a) => ({ name: a.ability.name, is_hidden: a.is_hidden })),
      height_m: p.height / 10, // API uses decimetres
      weight_kg: p.weight / 10, // API uses hectograms
      species: {
        name: s.name,
        genus: english(s.genera, 'genus'),
        generation: s.generation.name,
        is_legendary: s.is_legendary,
        is_mythical: s.is_mythical,
        flavor_text: clean(english(s.flavor_text_entries, 'flavor_text')),
      },
      damage_taken: matchups,
      evolution_chain: s.evolution_chain ? await evolutionChain(s.evolution_chain.url) : [],
    };
  });
  return withMatch(data, matchedFrom);
}

/** Type, damage class, power, accuracy, PP, priority and effect of a move. */
export async function getMoveData(name) {
  const [apiName, matchedFrom] = await resolve('move', name);
  const data = await cached(`move:${apiName}`, async () => {
    const m = await fetchJson(`move/${apiName}`);
    return {
      name: m.name,
      type: m.type.name,
      damage_class: m.damage_class.name,
      power: m.power,
      accuracy: m.accuracy,
      pp: m.pp,
      priority: m.priority,
      effect_chance: m.effect_chance, // % chance; some effect texts no longer include it
      effect: effectText(m),
    };
  });
  return withMatch(data, matchedFrom);
}

/** What an ability does. */
export async function getAbilityData(name) {
  const [apiName, matchedFrom] = await resolve('ability', name);
  const data = await cached(`ability:${apiName}`, async () => {
    const a = await fetchJson(`ability/${apiName}`);
    return { name: a.name, effect: effectText(a) };
  });
  return withMatch(data, matchedFrom);
}

// ---------- self-check: npm run check (hits PokeAPI, no LLM) ----------

if (import.meta.main) {
  const assert = (await import('node:assert/strict')).default;
  const show = (label, value) => console.log(`\n== ${label} ==\n${JSON.stringify(value, null, 2)}`);

  const zard = await getPokemonData('charizard');
  show('charizard', zard);
  assert.ok(zard.damage_taken['4x'].includes('rock'));
  assert.equal(zard.sprites, undefined);
  assert.equal(await getPokemonData('Charizard'), zard, 'second lookup should come from the cache');

  const eevee = await getPokemonData('eevee');
  assert.equal(eevee.evolution_chain.length, 8);

  assert.equal((await getPokemonData('mr mime')).name, 'mr-mime');

  const pika = await getPokemonData('pikachuu');
  assert.equal(pika.name, 'pikachu');
  assert.equal(pika.matched_from, 'pikachuu');

  const gira = await getPokemonData('giratina');
  assert.equal(gira.name, 'giratina-altered');
  assert.equal(gira.matched_from, undefined);
  assert.equal((await getPokemonData('giratin')).matched_from, 'giratin');

  await assert.rejects(getPokemonData('xyzzymon'), NotFoundError);
  await getPokemonData('bulbsaur poison').catch((e) => show('bulbsaur poison', e.message));

  show('flamethrower', await getMoveData('flamethrower'));
  show('blaze', await getAbilityData('blaze'));
  console.log('\nall checks passed');
}
