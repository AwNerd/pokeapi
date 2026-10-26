# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

CLI chatbot that answers Pokémon questions. An LLM calls tools over PokeAPI (https://pokeapi.co/api/v2) through the OpenAI SDK's Chat Completions API, so it works with any OpenAI-compatible endpoint.

- `pokeapi.py`: data layer, no LLM code. Fetches from PokeAPI (cached forever in `pokeapi_cache.sqlite`), resolves fuzzy names, returns small dicts.
- `tools.py`: `TOOLS` (one tool schema per public `pokeapi.py` function) and `run_tool(name, args_json)`, which always returns a JSON string. Errors come back as `{"error": ...}`.
- `bot.py`: chat loop and system prompt. Keeps the full message history and caps tool rounds at 5 per user turn.

## Commands

```sh
source venv/bin/activate
pip install -r requirements.txt
python bot.py       # run the chatbot
python pokeapi.py   # self-check: data layer (no LLM, no key needed)
python tools.py     # self-check: schema size + run_tool cases (no LLM, no key needed)
```

There is no test framework. The self-checks are the `__main__` blocks of `pokeapi.py` (plain `assert`s) and `tools.py` (prints results). They hit PokeAPI on the first run and the SQLite cache after that.

## Adding or changing a tool

1. Write a public function in `pokeapi.py` that takes one `name` string. Resolve the name with `resolve(resource, name)` (or `_pokemon(name)` for Pokémon), and wrap the returned dict in `_with_match(result, matched_from)` so auto-corrected names get flagged.
2. Add a schema to `TOOLS` in `tools.py` with `_tool(...)`. The tool name must match the function name exactly, because `FUNCTIONS` looks it up with `getattr(pokeapi, name)`.
3. Raise `pokeapi.NotFound` for bad input. That is the only exception `run_tool` turns into `{"error": ...}`; anything else (like network errors) crashes the bot.

Every tool takes exactly one `{"name": string}` argument, and schemas use `strict: True`. A tool with other arguments needs changes to both `_tool` and the argument check in `run_tool`.

If the new tool covers something listed under "Limitations" in README.md, update the README and the `SYSTEM_PROMPT` in `bot.py`, which tells the model what it has no data for.

## Environment

Set in `.env` (gitignored): `OPENAI_API_KEY`, `OPENAI_BASE_URL` (optional, for non-OpenAI endpoints), `OPENAI_MODEL` (defaults to `gpt-5-mini`). README.md has a Gemini free-tier example.

## Rules

- Keep it simple: plain functions, no frameworks (no LangChain/LangGraph), no over-engineering.
- Tools return small trimmed dicts, never raw API JSON.
- Deterministic logic (type math, evolution parsing, unit conversion) lives in Python, not the LLM.
