import { useEffect } from 'react'
import { ArrowRight, Moon, Sun } from 'lucide-react'
import { command } from './state'
import { Wordmark } from './ui'

export function Welcome({ animate }: { animate: boolean }) {
  useEffect(() => {
    const timer = setTimeout(() => { void command('finishWelcome') }, 2900)
    return () => clearTimeout(timer)
  }, [])

  return <section className={'welcome-screen' + (animate ? ' welcome-animated' : '')} role="dialog" aria-modal="true" aria-labelledby="welcome-title">
    <div className="welcome-body">
      <Wordmark decorative />
      <h1 id="welcome-title">Welcome to Drew</h1>
      <div className="welcome-profiles" aria-label="Starter Profiles">
        <div className="welcome-profile welcome-personal"><Moon size={17} /><div><strong>Personal</strong><small>True Black</small></div></div>
        <div className="welcome-profile welcome-work"><Sun size={17} /><div><strong>Work</strong><small>Light</small></div></div>
      </div>
      <button className="welcome-continue" autoFocus type="button" onClick={() => { void command('finishWelcome') }}>
        Open Drew <ArrowRight size={15} />
      </button>
    </div>
  </section>
}
