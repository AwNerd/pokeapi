"""Terminal chatbot that answers Pokémon questions using the tools in tools.py."""

import json
import os

import openai
from dotenv import load_dotenv

from tools import TOOLS, run_tool

load_dotenv()
client = openai.OpenAI()
MODEL = os.getenv("OPENAI_MODEL", "gpt-5-mini")
MAX_TOOL_ROUNDS = 5

SYSTEM_PROMPT = """You are a Pokemon expert assistant. Always use the tools for Pokemon facts (stats, types, matchups, evolutions, moves, abilities) instead of answering from memory. You can call multiple tools in one turn to compare two pokemon.
Pokemon, move and ability names can be passed as the user typed them, even misspelled. If a result includes matched_from the name was auto-corrected, so briefly mention which Pokemon you looked up. If a tool returns an error with suggestions, retry with the most likely suggestion or ask the user which they meant. If no tool covers the question (e.g. which moves a Pokemon learns) say you don't have that data instead of guessing. Keep answers concise."""

DIM, RESET = "\033[2m", "\033[0m"


def _call_label(call):
    try:
        arg = json.loads(call.function.arguments).get("name", call.function.arguments)
    except (json.JSONDecodeError, AttributeError):
        arg = call.function.arguments
    return f"{call.function.name}({arg})"


def answer(messages):
    """Run tool rounds until the model replies with text. Appends everything to messages."""
    for _ in range(MAX_TOOL_ROUNDS):
        msg = client.chat.completions.create(model=MODEL, messages=messages, tools=TOOLS).choices[0].message
        messages.append(msg.model_dump(exclude_none=True))
        if not msg.tool_calls:
            return msg.content
        for call in msg.tool_calls:
            print(f"{DIM}  → {_call_label(call)}{RESET}")
            result = run_tool(call.function.name, call.function.arguments)
            messages.append({"role": "tool", "tool_call_id": call.id, "content": result})

    # Out of tool rounds: make the model answer with what it has.
    msg = client.chat.completions.create(
        model=MODEL, messages=messages, tools=TOOLS, tool_choice="none"
    ).choices[0].message
    messages.append(msg.model_dump(exclude_none=True))
    return msg.content


def main():
    messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    print(f"Pokémon bot ({MODEL}). Type 'quit' to exit.")
    while True:
        try:
            text = input("\nyou> ").strip()
        except (KeyboardInterrupt, EOFError):
            break
        if text.lower() in ("quit", "exit"):
            break
        if not text:
            continue

        turn_start = len(messages)
        messages.append({"role": "user", "content": text})
        try:
            print(f"\nbot> {answer(messages)}")
        except KeyboardInterrupt:
            del messages[turn_start:]
            break
        except openai.OpenAIError as e:
            # Drop the half-finished turn so later requests aren't broken.
            del messages[turn_start:]
            print(f"\n[error talking to OpenAI: {e}]")
    print("\nbye!")


if __name__ == "__main__":
    main()
