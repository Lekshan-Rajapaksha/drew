import { Languages, MessageCircle, Sparkles, TextQuote, X } from 'lucide-react'
import { Tool } from './ui'
import type { Tab } from '../shared/model'

export type AssistantAction = 'summarize' | 'question' | 'explain-selection' | 'translate'

export interface AssistantProvider {
  run(request: {
    action: AssistantAction
    page: { url: string; title: string }
    approvedText: string
    prompt?: string
  }, signal: AbortSignal): Promise<string>
}

export function Assistant({ tab, close }: { tab?: Tab; close: () => void }) {
  return <aside className="assistant-page" aria-label="Page assistant">
    <header><Sparkles size={17} /><h2>Page assistant</h2><Tool label="Close assistant" onClick={close}><X size={15} /></Tool></header>
    <p className="muted">AI features are planned for a later release.</p>
    {tab && <div className="assistant-source">Current tab <strong>{tab.title}</strong></div>}
    <div className="assistant-actions">
      <button disabled><TextQuote size={18} /> Summarize the page</button>
      <button disabled><MessageCircle size={18} /> Ask about the page</button>
      <button disabled><Sparkles size={18} /> Explain selected text</button>
      <button disabled><Languages size={18} /> Translate page content</button>
    </div>
  </aside>
}
