// OpenAI tool calling loop and schemas. Works with any OpenAI-compatible endpoint
// (set OPENAI_BASE_URL), e.g. Gemini's.

import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import OpenAI from 'openai';
import { NotFoundError, getAbilityData, getMoveData, getPokemonData } from './pokeApi.js';

// Load backend/.env no matter which directory the server is started from.
dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)), quiet: true });

const MODEL = process.env.OPENAI_MODEL || 'gpt-5-mini';
const MAX_TOOL_ROUNDS = 5;

const SYSTEM_PROMPT = `You are a Pokémon expert assistant. Always use the tools for Pokémon facts (stats, types, matchups, evolutions, moves, abilities) instead of answering from memory. You can call several tools at once, e.g. to compare two Pokémon.
Pass Pokémon, move and ability names exactly as the user typed them, even misspelled; don't fix spelling yourself, the tools do that. Only when a result includes matched_from was the name auto-corrected: then briefly mention which one you looked up. Never mention a correction otherwise. If a tool returns an error with suggestions, retry with the most likely suggestion or ask the user which they meant. If no tool covers the question (e.g. which moves a Pokémon learns, items, locations) say you don't have that data instead of guessing. Keep answers concise.`;

function tool(name, description, paramDescription) {
  return {
    type: 'function',
    function: {
      name,
      description,
      strict: true,
      parameters: {
        type: 'object',
        properties: { name: { type: 'string', description: paramDescription } },
        required: ['name'],
        additionalProperties: false,
      },
    },
  };
}

export const TOOLS = [
  tool(
    'get_pokemon_details',
    'Everything about one Pokémon: types, base stats, abilities (names only), height (m), weight (kg), ' +
      'category, generation, legendary/mythical status, Pokédex entry, damage taken from each attacking type ' +
      '(both types already combined; types not listed are 1x), and its whole evolution family with conditions ' +
      '(an empty evolution_chain means it does not evolve). Does not include learnsets.',
    'Pokémon name'
  ),
  tool(
    'get_move_details',
    'Details of a move: type, damage class (physical/special/status), power, accuracy, PP, priority, ' +
      'effect text and effect chance (%). Does not say which Pokémon learn it.',
    'Move name'
  ),
  tool(
    'get_ability_details',
    "What an ability does. To find which abilities a Pokémon has, use get_pokemon_details.",
    'Ability name'
  ),
];

const FUNCTIONS = {
  get_pokemon_details: getPokemonData,
  get_move_details: getMoveData,
  get_ability_details: getAbilityData,
};

/** Run one tool call from the model. Always returns a JSON string; failures come back as {"error": ...}. */
export async function runTool(name, argsJson) {
  const fn = FUNCTIONS[name];
  if (!fn) return JSON.stringify({ error: `unknown tool '${name}'` });

  let args;
  try {
    args = JSON.parse(argsJson || '{}');
  } catch {
    args = null;
  }
  if (typeof args?.name !== 'string') {
    return JSON.stringify({ error: `invalid arguments for ${name}: expected {"name": string}` });
  }

  try {
    return JSON.stringify(await fn(args.name));
  } catch (err) {
    if (err instanceof NotFoundError) return JSON.stringify({ error: err.message });
    console.error(`[tool ${name}]`, err);
    return JSON.stringify({ error: 'PokeAPI request failed, try again later' });
  }
}

function callLabel(call) {
  try {
    return `${call.function.name}(${JSON.parse(call.function.arguments).name})`;
  } catch {
    return `${call.function.name}(${call.function.arguments})`;
  }
}

// Precaution: stricter OpenAI-compatible endpoints (e.g. Gemini) may reject null fields echoed back.
function withoutNulls(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v != null));
}

let client;

/**
 * Answer the latest user message. `history` is the conversation so far as
 * [{role: 'user' | 'assistant', content: string}], ending with the user's message.
 * Returns {reply, toolCalls}, where toolCalls are labels like "get_pokemon_details(charizard)".
 */
export async function chat(history) {
  client ??= new OpenAI();
  const messages = [{ role: 'system', content: SYSTEM_PROMPT }, ...history];
  const toolCalls = [];
  const complete = async (extra = {}) => {
    const res = await client.chat.completions.create({ model: MODEL, messages, tools: TOOLS, ...extra });
    const msg = res.choices[0].message;
    messages.push(withoutNulls(msg));
    return msg;
  };

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const msg = await complete();
    if (!msg.tool_calls?.length) return { reply: msg.content ?? '', toolCalls };

    toolCalls.push(...msg.tool_calls.map(callLabel));
    const results = await Promise.all(msg.tool_calls.map((c) => runTool(c.function.name, c.function.arguments)));
    msg.tool_calls.forEach((c, i) => messages.push({ role: 'tool', tool_call_id: c.id, content: results[i] }));
  }

  // Out of tool rounds: make the model answer with what it has.
  const msg = await complete({ tool_choice: 'none' });
  return { reply: msg.content ?? '', toolCalls };
}
