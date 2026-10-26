// Express server setup and routing.

import cors from 'cors';
import express from 'express';
import OpenAI from 'openai';
import { chat } from './services/llmService.js'; // also loads backend/.env

const PORT = Number(process.env.PORT) || 3000;
const CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:5173'; // Vite dev server
const MAX_MESSAGES = 30; // older history is dropped to bound token use
const MAX_CHARS = 2000; // per message

const app = express();
app.use(cors({ origin: CORS_ORIGIN }));
app.use(express.json({ limit: '100kb' }));

/** Returns the trimmed history, or an error string if the body is malformed. */
function parseMessages(body) {
  const messages = body?.messages;
  if (!Array.isArray(messages) || messages.length === 0) return 'messages must be a non-empty array';
  for (const m of messages) {
    if (!['user', 'assistant'].includes(m?.role) || typeof m.content !== 'string') {
      return 'each message needs role "user" or "assistant" and string content';
    }
    if (m.content.length > MAX_CHARS) return `messages must be at most ${MAX_CHARS} characters`;
  }
  if (messages.at(-1).role !== 'user') return 'the last message must be from the user';
  if (!messages.at(-1).content.trim()) return 'the last message is empty';

  let recent = messages.slice(-MAX_MESSAGES);
  // Some endpoints require history to start with a user turn.
  while (recent[0].role !== 'user') recent = recent.slice(1);
  return recent.map(({ role, content }) => ({ role, content }));
}

// Body: {messages: [{role, content}, ...]} ending with the user's question.
// Response: {reply, toolCalls} or {error}.
app.post('/api/chat', async (req, res) => {
  const history = parseMessages(req.body);
  if (typeof history === 'string') return res.status(400).json({ error: history });

  try {
    res.json(await chat(history));
  } catch (err) {
    console.error('[/api/chat]', err);
    if (err instanceof OpenAI.RateLimitError) {
      return res.status(429).json({ error: 'The AI service is rate limited. Wait a moment and try again.' });
    }
    if (err instanceof OpenAI.APIError) {
      return res.status(502).json({ error: 'The AI service returned an error. Try again.' });
    }
    res.status(500).json({ error: 'Something went wrong on the server.' });
  }
});

// Malformed JSON bodies and other unhandled errors: answer with JSON, not an HTML page.
app.use((err, _req, res, next) => {
  if (res.headersSent) return next(err);
  const status = err.status || err.statusCode || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status === 400 ? 'invalid JSON body' : 'Something went wrong on the server.' });
});

app.listen(PORT, () => {
  console.log(`Backend listening on http://localhost:${PORT} (CORS origin: ${CORS_ORIGIN})`);
  if (!process.env.OPENAI_API_KEY) console.warn('Warning: OPENAI_API_KEY is not set in backend/.env');
});
