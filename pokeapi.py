"""Data layer over PokeAPI. Every public function returns a small dict meant for an LLM's context."""

import difflib
import functools
import re
from pathlib import Path

import requests_cache

BASE_URL = "https://pokeapi.co/api/v2"
# PokeAPI data never changes, so cached responses never expire.
SESSION = requests_cache.CachedSession(
    str(Path(__file__).parent / "pokeapi_cache"), backend="sqlite", expire_after=-1
)

AUTO_FIX_RATIO = 0.85  # fuzzy matches at least this similar are used without asking


class NotFound(Exception):
    pass


def _get(path):
    """GET a path like 'pokemon/25' or a full PokeAPI URL and return the JSON."""
    url = path if path.startswith("http") else f"{BASE_URL}/{path.strip('/')}"
    resp = SESSION.get(url)
    if resp.status_code == 404:
        raise NotFound(f"not found: {url}")
    resp.raise_for_status()
    return resp.json()


# ---------- name resolution ----------

def normalize(name):
    name = name.lower().strip()
    name = re.sub(r"[ .]", "-", name).replace("'", "")
    return re.sub(r"-+", "-", name).strip("-")


@functools.lru_cache
def _names(resource):
    return [r["name"] for r in _get(f"{resource}?limit=2000")["results"]]


def _default_variety(species):
    data = _get(f"pokemon-species/{species}")
    return next(v["pokemon"]["name"] for v in data["varieties"] if v["is_default"])


def resolve(resource, name):
    """Return (api_name, matched_from). matched_from is the user's input if it was auto-corrected."""
    n = normalize(name)
    names = _names(resource)
    if n in names:
        return n, None

    # Base names like "giratina" are species; the pokemon is "giratina-altered".
    species = _names("pokemon-species") if resource == "pokemon" else []
    if n in species:
        return _default_variety(n), None

    candidates = names + [s for s in species if s not in set(names)]
    matches = difflib.get_close_matches(n, candidates, n=3, cutoff=0.6)
    if matches and difflib.SequenceMatcher(None, n, matches[0]).ratio() >= AUTO_FIX_RATIO:
        best = matches[0]
        return (best if best in names else _default_variety(best)), name

    label = resource.replace("-", " ")
    if matches:
        raise NotFound(f"no {label} '{name}', did you mean: {', '.join(matches)}?")
    raise NotFound(f"no {label} '{name}' found")


def _with_match(result, matched_from):
    if matched_from:
        result["matched_from"] = matched_from
    return result


# ---------- text helpers ----------

def _en(entries, field):
    """Field of the latest English entry, or None."""
    english = [e for e in entries if e["language"]["name"] == "en"]
    return english[-1][field] if english else None


def _clean(text):
    if text is None:
        return None
    return " ".join(text.replace("\f", " ").replace("\n", " ").replace("­", " ").split())


# ---------- public functions ----------

def _pokemon(name):
    api_name, matched_from = resolve("pokemon", name)
    return _get(f"pokemon/{api_name}"), matched_from


def get_pokemon(name):
    p, matched_from = _pokemon(name)
    return _with_match({
        "name": p["name"],
        "id": p["id"],
        "types": [t["type"]["name"] for t in p["types"]],
        "stats": {s["stat"]["name"]: s["base_stat"] for s in p["stats"]},
        "abilities": [{"name": a["ability"]["name"], "is_hidden": a["is_hidden"]} for a in p["abilities"]],
        "height_m": p["height"] / 10,
        "weight_kg": p["weight"] / 10,
        "sprite": p["sprites"]["other"]["official-artwork"]["front_default"],
    }, matched_from)


def get_species(name):
    p, matched_from = _pokemon(name)
    s = _get(p["species"]["url"])
    return _with_match({
        "name": s["name"],
        "genus": _en(s["genera"], "genus"),
        "generation": s["generation"]["name"],
        "is_legendary": s["is_legendary"],
        "is_mythical": s["is_mythical"],
        "flavor_text": _clean(_en(s["flavor_text_entries"], "flavor_text")),
    }, matched_from)


# Bookkeeping fields that repeat on every entry and don't help answer questions.
_EVO_NOISE = {"version_group", "is_default", "required_pokemon_form"}


def _condition(details):
    """Keep only meaningful fields. 0 is kept (Tyrogue uses relative_physical_stats: 0)."""
    cond = {}
    for key, val in details.items():
        if key in _EVO_NOISE or val is None or val is False or val == "" or val == []:
            continue
        cond[key] = val["name"] if isinstance(val, dict) and "name" in val else val
    return cond


def get_evolution_chain(name):
    p, matched_from = _pokemon(name)
    species = _get(p["species"]["url"])
    root = _get(species["evolution_chain"]["url"])["chain"]

    chain = []

    def walk(node):
        for nxt in node["evolves_to"]:
            conditions = []
            for d in nxt["evolution_details"]:
                c = _condition(d)
                if c not in conditions:
                    conditions.append(c)
            chain.append({"from": node["species"]["name"], "to": nxt["species"]["name"], "condition": conditions})
            walk(nxt)

    walk(root)
    return _with_match({"name": species["name"], "chain": chain}, matched_from)


def get_type_matchups(name):
    p, matched_from = _pokemon(name)
    types = [t["type"]["name"] for t in p["types"]]

    mult = {}
    for t in types:
        rel = _get(f"type/{t}")["damage_relations"]
        for factor, key in ((2, "double_damage_from"), (0.5, "half_damage_from"), (0, "no_damage_from")):
            for atk in rel[key]:
                mult[atk["name"]] = mult.get(atk["name"], 1) * factor

    result = {"name": p["name"], "types": types, "4x": [], "2x": [], "0.5x": [], "0.25x": [], "0x": []}
    labels = {4: "4x", 2: "2x", 0.5: "0.5x", 0.25: "0.25x", 0: "0x"}
    for atk, m in sorted(mult.items()):
        if m in labels:
            result[labels[m]].append(atk)
    return _with_match(result, matched_from)


def _effect(data):
    """English short_effect with $effect_chance filled in, else the latest English flavor text."""
    effect = _en(data["effect_entries"], "short_effect")
    if effect is None:
        return _clean(_en(data["flavor_text_entries"], "flavor_text"))
    if data.get("effect_chance") is not None:
        effect = effect.replace("$effect_chance", str(data["effect_chance"]))
    return _clean(effect)


def get_move(name):
    api_name, matched_from = resolve("move", name)
    m = _get(f"move/{api_name}")
    return _with_match({
        "name": m["name"],
        "type": m["type"]["name"],
        "damage_class": m["damage_class"]["name"],
        "power": m["power"],
        "accuracy": m["accuracy"],
        "pp": m["pp"],
        "priority": m["priority"],
        "effect_chance": m["effect_chance"],  # % chance; some effect texts no longer include it
        "effect": _effect(m),
    }, matched_from)


def get_ability(name):
    api_name, matched_from = resolve("ability", name)
    a = _get(f"ability/{api_name}")
    return _with_match({"name": a["name"], "effect": _effect(a)}, matched_from)


if __name__ == "__main__":
    from pprint import pprint

    def show(label, value):
        print(f"\n== {label} ==")
        pprint(value, sort_dicts=False)

    show("charizard", get_pokemon("charizard"))
    show("charizard species", get_species("charizard"))
    matchups = get_type_matchups("charizard")
    show("charizard matchups", matchups)
    assert "rock" in matchups["4x"], matchups

    evo = get_evolution_chain("eevee")
    show("eevee evolutions", evo)
    assert len(evo["chain"]) == 8, len(evo["chain"])

    mime = get_pokemon("mr mime")
    show("mr mime", mime)
    assert mime["name"] == "mr-mime"

    pika = get_pokemon("pikachuu")
    show("pikachuu", pika)
    assert pika["name"] == "pikachu" and pika["matched_from"] == "pikachuu"

    gira = get_pokemon("giratina")
    show("giratina", gira)
    assert gira["name"] == "giratina-altered" and "matched_from" not in gira

    gira2 = get_pokemon("giratin")
    show("giratin", gira2)
    assert gira2["name"] == "giratina-altered" and gira2["matched_from"] == "giratin"

    try:
        get_pokemon("xyzzymon")
        raise AssertionError("expected NotFound")
    except NotFound as e:
        show("xyzzymon", str(e))

    show("flamethrower", get_move("flamethrower"))
    show("blaze", get_ability("blaze"))
    print("\nall checks passed")
