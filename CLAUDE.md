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

## Environment

Set in `.env` (gitignored): `OPENAI_API_KEY`, `OPENAI_BASE_URL` (optional, for non-OpenAI endpoints), `OPENAI_MODEL` (defaults to `gpt-5-mini`).

## Rules

- Keep it simple: plain functions, no frameworks (no LangChain/LangGraph), no over-engineering.
- Tools return small trimmed dicts, never raw API JSON.
- Deterministic logic (type math, evolution parsing, unit conversion) lives in Python, not the LLM.
