// Individual chat bubble.
import { Bot, CircleAlert, Search, User } from 'lucide-react'

// Models often use "* item" lists and **bold**; render those and keep everything else as plain text.
function formatText(text) {
  const withBullets = text.replace(/^([ \t]*)[*-][ \t]+/gm, '$1• ')
  return withBullets.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') && part.length > 4 ? (
      <strong key={i}>{part.slice(2, -2)}</strong>
    ) : (
      part
    ),
  )
}

export default function Message({ role, content, toolCalls = [], isError = false }) {
  const isUser = role === 'user'
  const Icon = isError ? CircleAlert : isUser ? User : Bot

  const bubble = isUser
    ? 'bg-red-600 text-white rounded-br-sm'
    : isError
      ? 'bg-amber-50 text-amber-900 border border-amber-200 rounded-bl-sm dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-900'
      : 'bg-white text-slate-800 border border-slate-200 rounded-bl-sm dark:bg-slate-900 dark:text-slate-100 dark:border-slate-800'

  return (
    <div className={`flex items-end gap-2 ${isUser ? 'flex-row-reverse' : ''}`}>
      <div
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
          isUser
            ? 'bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
            : isError
              ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300'
              : 'bg-red-100 text-red-600 dark:bg-red-950 dark:text-red-400'
        }`}
        aria-hidden="true"
      >
        <Icon size={16} />
      </div>
      <div className={`flex max-w-[85%] flex-col gap-1 sm:max-w-[75%] ${isUser ? 'items-end' : 'items-start'}`}>
        <div className={`whitespace-pre-wrap break-words rounded-2xl px-4 py-2.5 text-sm leading-relaxed shadow-sm ${bubble}`}>
          {isUser ? content : formatText(content)}
        </div>
        {toolCalls.length > 0 && (
          <div className="flex flex-wrap items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
            <Search size={12} aria-hidden="true" />
            <span className="sr-only">Looked up:</span>
            {toolCalls.map((call, i) => (
              <code key={i} className="rounded bg-slate-100 px-1.5 py-0.5 dark:bg-slate-800">
                {call}
              </code>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
