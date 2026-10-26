# pokeapi chatbot

A web chatbot that answers Pokémon questions. An LLM calls tools over [PokeAPI](https://pokeapi.co) through an Express backend, and a React chat UI talks to that backend.

## Setup

Requires Node 22.18+ (tested on Node 24) and Python 3 (for `main.py`, standard library only).

Create `backend/.env`. The backend uses the OpenAI SDK, so any OpenAI-compatible endpoint works.

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

Optional: `PORT` (default `3000`) and `CORS_ORIGIN` (default `http://localhost:5173`). The frontend reads `VITE_API_URL` (default `http://localhost:3000`).

## Run

From the repo root:

```sh
python3 main.py
```

The first time, this runs `npm install` in `backend/` and `frontend/`. It then starts both dev servers in one terminal (backend on :3000, frontend on :5173, with `[backend]` / `[frontend]` log prefixes) and opens http://localhost:5173 when the page is ready. Ctrl+C stops both. It exits with a message if `backend/.env` is missing or either port is already taken.

To run the servers yourself, use two terminals:

```sh
cd backend && npm install && npm run dev     # http://localhost:3000
cd frontend && npm install && npm run dev    # http://localhost:5173
```

Each bot reply lists the lookups it made, e.g. `get_pokemon_details(charizard)`.

## How it works

```
React UI ──POST /api/chat {messages}──▶ Express ──▶ OpenAI-compatible LLM
                                           │              │ tool calls
                                           │              ▼
                                           │        pokeApi.js ──▶ PokeAPI
                                           │              │ (node-cache)
◀──────────── {reply, toolCalls} ──────────┘◀─────────────┘
```

| File | Role |
|---|---|
| `backend/services/pokeApi.js` | Data layer. Fetches from PokeAPI, resolves names, returns small filtered objects. No LLM code. |
| `backend/services/llmService.js` | Tool schemas, `runTool`, and the `chat(history)` tool loop (max 5 rounds, then a forced final answer). |
| `backend/server.js` | Express app: CORS, JSON, request validation, `POST /api/chat`. |
| `backend/utils/cache.js` | Shared `node-cache` instance. |
| `frontend/src/components/ChatBox.jsx` | Message and loading state, calls the backend. |
| `frontend/src/components/Message.jsx`, `ChatInput.jsx` | Chat bubble and input. |

The server is stateless: the frontend sends the whole conversation (user and assistant text) on every request, so follow-up questions like "how does it evolve?" work.

## Design decisions

- **Filtered tool output.** Tools never return raw API JSON. Charizard's raw `/pokemon` response is ~370k characters; `get_pokemon_details` returns under 1k, including species info, type matchups and evolutions.
- **Deterministic work in code.** The backend combines type multipliers for dual types, flattens branching evolution trees into steps, and converts units (dm → m, hg → kg). The model never does this math.
- **Forgiving names.** Input is normalized (`"Mr. Mime"` → `mr-mime`). Base names like `giratina` resolve to the default form (`giratina-altered`). Close typos (≥ 0.85 similarity, a port of Python's `difflib`) are auto-corrected and flagged with `matched_from`. Weaker matches return an error with suggestions.
- **Errors go back to the model.** Unknown names (PokeAPI 404s), bad arguments, unknown tools and PokeAPI outages all come back as `{"error": ...}`, so the model can retry or ask instead of failing the request.
- **Cached in memory.** Filtered results are cached in `node-cache` with no expiry, since PokeAPI data doesn't change. The cache resets when the server restarts.

## What the tools cover

| Tool | Answers |
|---|---|
| `get_pokemon_details` | types, base stats, abilities (names), height, weight, category, generation, legendary/mythical, Pokédex entry, damage taken from each type (4x / 2x / 0.5x / 0.25x / 0x), evolution chain with conditions |
| `get_move_details` | type, damage class, power, accuracy, PP, priority, effect, effect chance |
| `get_ability_details` | what an ability does |

### Limitations

- No learnsets, so the bot can't tell which moves a Pokémon learns or which Pokémon learn a move.
- No sprites/images, held items, encounter locations, natures, or competitive data.
- Type matchups are defensive only.
- Evolution conditions don't say which game each one applies to.
- English text only.
- Non-default forms have to be requested by full name, e.g. `charizard-mega-x`.

## Self-check

```sh
cd backend && npm run check   # hits PokeAPI, no LLM or API key needed
```

Asserts e.g. Charizard is 4x weak to Rock, Eevee has 8 evolutions, typos are corrected, unknown names throw, and repeat lookups come from the cache.
