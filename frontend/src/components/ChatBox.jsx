// Main chat container and state manager.
import { useEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import ChatInput from './ChatInput.jsx'
import Message from './Message.jsx'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000'

const EXAMPLES = [
  'Is Charizard weak to Rock?',
  'How does Eevee evolve?',
  'Compare Pikachu and Raichu speed',
  'What does Intimidate do?',
]

let nextId = 0

export default function ChatBox() {
  // Each message: {id, role: 'user' | 'assistant', content, toolCalls?, isError?, failed?}
  const [messages, setMessages] = useState([])
  const [isLoading, setIsLoading] = useState(false)
  const bottomRef = useRef(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages, isLoading])

  async function sendMessage(text) {
    if (isLoading) return
    const userMsg = { id: nextId++, role: 'user', content: text }
    // History for the backend: skip error bubbles and questions that failed.
    const history = [...messages, userMsg]
      .filter((m) => !m.isError && !m.failed)
      .map(({ role, content }) => ({ role, content }))

    setMessages((prev) => [...prev, userMsg])
    setIsLoading(true)
    try {
      const res = await fetch(`${API_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: history }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`)
      setMessages((prev) => [
        ...prev,
        {
          id: nextId++,
          role: 'assistant',
          content: data.reply || "Sorry, I couldn't come up with an answer.",
          toolCalls: data.toolCalls || [],
        },
      ])
    } catch (err) {
      const message =
        err instanceof TypeError
          ? "Can't reach the server. Is the backend running on port 3000?"
          : err.message
      setMessages((prev) => [
        ...prev.map((m) => (m.id === userMsg.id ? { ...m, failed: true } : m)),
        { id: nextId++, role: 'assistant', content: message, isError: true },
      ])
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-y-auto px-4 py-6" aria-live="polite">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Ask about types, stats, weaknesses, evolutions, moves or abilities.
            </p>
            <div className="flex max-w-md flex-wrap justify-center gap-2">
              {EXAMPLES.map((q) => (
                <button
                  key={q}
                  onClick={() => sendMessage(q)}
                  className="rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-700 transition hover:border-red-400 hover:text-red-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-red-500 dark:hover:text-red-400"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {messages.map((m) => (
              <Message key={m.id} {...m} />
            ))}
            {isLoading && (
              <div className="flex items-center gap-2 pl-10 text-sm text-slate-500 dark:text-slate-400">
                <Loader2 size={16} className="animate-spin" aria-hidden="true" />
                Looking that up…
              </div>
            )}
          </div>
        )}
        <div ref={bottomRef} />
      </div>
      <div className="border-t border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950">
        <ChatInput onSend={sendMessage} disabled={isLoading} />
      </div>
    </div>
  )
}
