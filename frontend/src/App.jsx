import { Bot } from 'lucide-react'
import ChatBox from './components/ChatBox.jsx'

export default function App() {
  return (
    <div className="flex h-dvh items-stretch justify-center bg-slate-100 sm:items-center sm:p-6 dark:bg-slate-950">
      <main className="flex h-full w-full max-w-2xl flex-col overflow-hidden bg-slate-50 sm:h-[min(100%,48rem)] sm:rounded-2xl sm:border sm:border-slate-200 sm:shadow-lg dark:bg-slate-950 dark:sm:border-slate-800">
        <header className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-red-600 text-white">
            <Bot size={20} aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-base font-semibold text-slate-900 dark:text-slate-100">Pokémon Chatbot</h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">Answers from PokeAPI</p>
          </div>
        </header>
        <div className="min-h-0 flex-1">
          <ChatBox />
        </div>
      </main>
    </div>
  )
}
