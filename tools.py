"""OpenAI tool schemas for pokeapi.py, plus run_tool() to execute a tool call."""

import json

import pokeapi


def _tool(name, description, param_description):
    return {
        "type": "function",
        "function": {
            "name": name,
            "description": description,
            "strict": True,
            "parameters": {
                "type": "object",
                "properties": {"name": {"type": "string", "description": param_description}},
                "required": ["name"],
                "additionalProperties": False,
            },
        },
    }


TOOLS = [
    _tool(
        "get_pokemon",
        "Basic facts about a Pokémon: types, base stats, ability names, height (m), weight (kg) and "
        "artwork URL. Use for questions about type, stats, size, or which abilities it can have. "
        "For weaknesses use get_type_matchups; for what an ability does use get_ability.",
        "Pokémon name",
    ),
    _tool(
        "get_species",
        "Species info for a Pokémon: category (e.g. 'Flame Pokémon'), generation introduced, "
        "whether it is legendary or mythical, and its Pokédex entry. Use for lore, "
        "'is it legendary', or 'what generation is it from'.",
        "Pokémon name",
    ),
    _tool(
        "get_evolution_chain",
        "The Pokémon's whole evolution family as from -> to steps, each with how it happens "
        "(level, item, friendship, time of day, location, etc.). Use for how it evolves, "
        "what it evolves into or from. An empty chain means it doesn't evolve.",
        "Pokémon name (any member of the family)",
    ),
    _tool(
        "get_type_matchups",
        "How much damage a Pokémon takes from each attacking type, with both of its types "
        "already combined, grouped into 4x, 2x, 0.5x, 0.25x and 0x (types not listed are 1x). "
        "Use for weaknesses, resistances, immunities, or what to use against it.",
        "Pokémon name",
    ),
    _tool(
        "get_move",
        "Details of a move: type, damage class (physical/special/status), power, accuracy, PP, "
        "priority, effect text and effect chance (%). Use for any question about a specific move. "
        "Does not say which Pokémon learn it.",
        "Move name",
    ),
    _tool(
        "get_ability",
        "What an ability does. Use when asked about an ability's effect. "
        "To find which abilities a Pokémon has, use get_pokemon.",
        "Ability name",
    ),
]

FUNCTIONS = {t["function"]["name"]: getattr(pokeapi, t["function"]["name"]) for t in TOOLS}


def _dumps(obj):
    return json.dumps(obj, ensure_ascii=False)


def run_tool(name, args_json):
    """Run a tool call from the model and return the result as a JSON string."""
    fn = FUNCTIONS.get(name)
    if fn is None:
        return _dumps({"error": f"unknown tool '{name}'"})
    try:
        args = json.loads(args_json or "{}")
    except json.JSONDecodeError:
        args = None
    if not isinstance(args, dict) or not isinstance(args.get("name"), str):
        return _dumps({"error": f"invalid arguments for {name}: expected {{\"name\": string}}"})
    try:
        return _dumps(fn(args["name"]))
    except pokeapi.NotFound as e:
        return _dumps({"error": str(e)})


if __name__ == "__main__":
    print("schema overhead:", len(json.dumps(TOOLS)), "chars")

    calls = [
        ("get_type_matchups", '{"name": "charizard"}'),
        ("get_pokemon", '{"name": "pikachuu"}'),
        ("get_move", '{"name": "thunderbolt"}'),
        ("get_ability", '{"name": "intimidate"}'),
        ("get_pokemon", '{"name": "bulbsaur poison"}'),
        ("get_pokemon", '{"nmae": "eevee"}'),
        ("get_pokemon", "not json"),
        ("get_weather", '{"name": "rain"}'),
    ]
    for name, args in calls:
        print(f"\n{name}({args})\n  -> {run_tool(name, args)}")
