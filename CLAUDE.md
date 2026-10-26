# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Project: CLI chatbot answering Pokémon questions. OpenAI tool-calling LLM over PokeAPI (https://pokeapi.co/api/v2).
Files: pokeapi.py (data layer, no LLM), tools.py (tool schemas), bot.py (chat loop).
Rules: keep it simple, no frameworks (no LangChain/LangGraph), no over-engineering. 
Tools return small trimmed dicts, never raw API JSON. Deterministic logic (type math, evolution parsing) lives in Python, not the LLM.

## Environment

- Python 3.12 virtualenv at `venv/` (only `pip` installed so far).
  - Activate: `source venv/bin/activate`
  - Install deps: `pip install -r requirements.txt`
- Secrets/config live in `.env` (gitignored). Don't commit it.
- `venv/` is not in `.gitignore` yet; add it before the first commit.