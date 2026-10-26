# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Web chatbot that answers Pokémon questions. Monorepo with two npm packages (no workspace tooling):

- `backend/`: Node + Express 5 (ESM). An LLM calls tools over PokeAPI (https://pokeapi.co/api/v2) via the OpenAI SDK's Chat Completions API, so any OpenAI-compatible endpoint works (currently configured for Gemini).
- `frontend/`: React 19 + Vite + Tailwind CSS v3 + lucide-react.

Request flow: `ChatBox.jsx` POSTs the whole conversation `{messages: [{role, content}]}` to `POST /api/chat` → `server.js` validates it → `llmService.chat(history)` runs the tool loop → returns `{reply, toolCalls}`. The server keeps no session state.

- `backend/services/pokeApi.js`: data layer, no LLM code. Fetches from PokeAPI, resolves fuzzy names, returns small filtered objects, and caches filtered results (never raw JSON) in `utils/cache.js`.
- `backend/services/llmService.js`: `TOOLS` schemas, `runTool(name, argsJson)` (always returns a JSON string; errors come back as `{"error": ...}`), system prompt, and `chat()`. Caps tool rounds at 5 per request, then makes one final call with `tool_choice: 'none'`. Loads `backend/.env`.
- `backend/server.js`: CORS (single allowed origin), JSON parsing, request validation (roles, 2000 chars per message, last 30 messages kept), and LLM errors mapped to 429/502/500 JSON.

## Commands

```sh
cd backend && npm install && npm run dev    # API on :3000 (node --watch)
cd frontend && npm install && npm run dev   # UI on :5173 (strictPort)
cd backend && npm run check                 # self-check: data layer asserts against PokeAPI (no LLM, no key needed)
cd frontend && npm run build                # production build; also catches JSX/Tailwind errors
```

There is no test framework or linter. `npm run check` runs the `import.meta.main` block at the bottom of `pokeApi.js`.

## Environment

Set in `backend/.env` (gitignored): `OPENAI_API_KEY`, `OPENAI_BASE_URL` (optional, for non-OpenAI endpoints), `OPENAI_MODEL` (defaults to `gpt-5-mini`). Optional: `PORT` (3000), `CORS_ORIGIN` (`http://localhost:5173`). Frontend: `VITE_API_URL` (`http://localhost:3000`). The dev ports and `CORS_ORIGIN` must agree.

## Adding or changing a tool

1. Write an exported async function in `pokeApi.js` that takes one `name` string. Resolve it with `resolve(resource, name)`, wrap the fetch-and-filter in `cached(key, load)` keyed by the resolved API name, and return `withMatch(data, matchedFrom)` so auto-corrected names get flagged.
2. Add a schema with `tool(...)` to `TOOLS` in `llmService.js`, and map its name to the function in `FUNCTIONS`.
3. Throw `NotFoundError` for bad input. `runTool` returns its message to the model; any other error becomes a generic "PokeAPI request failed" error.

Every tool takes exactly one `{"name": string}` argument with `strict: true` schemas. A tool with other arguments needs changes to both `tool()` and the argument check in `runTool`.

If a new tool covers a "Limitations" item in README.md, update the README and `SYSTEM_PROMPT`, which tells the model what it has no data for.

## Gotchas

- `cache.js` uses `useClones: false` and stores promises (so parallel calls share one request). Never mutate a cached object; `withMatch` copies before adding `matched_from`.
- The cache is in-memory with no expiry; it resets on server restart.
- `chat()` strips null fields from assistant messages before sending them back, as a precaution for stricter OpenAI-compatible endpoints like Gemini's (the old Python bot did the same). Gemini's free tier also rate-limits quickly (surfaces as a 429 from `/api/chat`).

## Rules

- Keep it simple: plain functions, no frameworks beyond Express/React (no LangChain/LangGraph), no over-engineering.
- Tools return small trimmed objects, never raw API JSON.
- Deterministic logic (type math, evolution parsing, unit conversion) lives in code, not the LLM.
