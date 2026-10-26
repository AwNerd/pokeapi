# pokeapi chatbot

A CLI chatbot that answers Pokémon questions using an LLM with tool calling over [PokeAPI](https://pokeapi.co).

## Setup

```sh
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

Create a `.env` file in the project root. It uses the OpenAI SDK, so any OpenAI-compatible endpoint works.

Gemini free tier:

```sh
OPENAI_API_KEY=your-gemini-api-key
OPENAI_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai/
OPENAI_MODEL=gemini-2.5-flash
```

Plain OpenAI (model defaults to `gpt-5-mini`):

```sh
OPENAI_API_KEY=your-openai-api-key
```

## Run

```sh
python bot.py
```

Type `quit`, `exit`, Ctrl+C or Ctrl+D to leave. Each tool call is shown as a dim `→` line. Example session (the model's wording will vary):

```
you> is charizard weak to rock?
  → get_type_matchups(charizard)

bot> Yes, 4x. Charizard is Fire/Flying and both types are weak to Rock.

you> what about its evolutions
  → get_evolution_chain(charizard)

bot> Charmander evolves into Charmeleon at level 16, then Charizard at level 36.

you> compare pikachuu and raichu speed
  → get_pokemon(pikachuu)
  → get_pokemon(raichu)

bot> (Looked up Pikachu.) Raichu is faster: 110 base Speed vs Pikachu's 90.
```

## How it works

| File | Role |
|---|---|
| `pokeapi.py` | Data layer. Fetches from PokeAPI, resolves names, returns small dicts. No LLM code. |
| `tools.py` | `TOOLS` (Chat Completions tool schemas, one per `pokeapi.py` function) and `run_tool(name, args_json)`, which runs a call and returns a JSON string. |
| `bot.py` | Chat loop and system prompt. Keeps the full message history so follow-up questions work. |

Flow for each question:

```
user → model → tool call(s) → run_tool → pokeapi.py → PokeAPI
                    ↑                                    │
                    └──────── JSON result ───────────────┘
model → (more tool calls, up to 5 rounds) → answer
```

If the model still wants tools after 5 rounds, it gets one last call with tools disabled so it answers with what it has. If an API call fails, the error is printed, that turn is dropped from the history, and the chat continues.

## Design decisions

- **Trimmed tool output.** Tools never return raw API JSON (`/pokemon` alone is huge because of its moves list). They return only the fields needed to answer questions, to save tokens.
- **Deterministic work in Python.** The code combines the type multipliers for dual-type Pokémon, flattens branching evolution trees into a list of steps, and converts units (dm → m, hg → kg). The model never does this math.
- **Forgiving names.** Input is normalized (`"Mr. Mime"` → `mr-mime`). Base names like `giratina` resolve to the default form (`giratina-altered`). Close typos (≥ 0.85 similarity) are auto-corrected and flagged with `matched_from`, so the model can tell the user. Weaker matches return an error with suggestions.
- **Errors go back to the model.** `run_tool` returns `{"error": ...}` for unknown names, bad arguments or unknown tools, so the model can retry or ask instead of the bot crashing.
- **Cached in SQLite.** Every PokeAPI response is cached in `pokeapi_cache.sqlite` and never expires, as PokeAPI asks and since the data doesn't change.

## What the tools cover

| Tool | Answers |
|---|---|
| `get_pokemon` | types, base stats, abilities (names only), height, weight, artwork URL |
| `get_species` | category, generation, legendary/mythical, Pokédex entry |
| `get_evolution_chain` | full evolution family with conditions (level, item, friendship, location, ...) |
| `get_type_matchups` | damage taken from each attacking type (4x / 2x / 0.5x / 0.25x / 0x) |
| `get_move` | type, damage class, power, accuracy, PP, priority, effect, effect chance |
| `get_ability` | what an ability does |

### Limitations

- No learnsets, so the bot can't tell which moves a Pokémon learns or which Pokémon learn a move.
- No held items, items in general, encounter locations, natures, or competitive data.
- Type matchups are defensive only. There's no "what is Fire super effective against" lookup for a type on its own.
- Evolution conditions don't say which game each one applies to (e.g. Leafeon's evolution spots in different games).
- English text only.
- Non-default forms have to be requested by their full name, e.g. `charizard-mega-x` or `giratina-origin`.

## Self-checks

These hit PokeAPI (or the cache) but don't call the LLM, so no API key is needed.

```sh
python pokeapi.py   # prints sample results and asserts e.g. Charizard is 4x weak to Rock, Eevee has 8 evolutions
python tools.py     # prints the schema size and runs run_tool on good, misspelled and bad inputs
```
