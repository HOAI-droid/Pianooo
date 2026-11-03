// ── Practice controls on the piano roll ─────────────────────────────────────
// PracticeButton: top left of the roll, opens the panel where you choose the
// mode, the hand, accompaniment and automatic speed-up.
// PracticeHud: score while practising, the count-in, and the result card.

import React, { useEffect, useRef, useState } from 'react'
import { GraduationCap, Check, X, RotateCcw, Hand as HandIcon, Timer, Hourglass, Play } from 'lucide-react'
import { useStore } from '../store'
import { t } from '../utils/i18n'
import { usePractice, startPractice, stopPractice, type PracticeMode, type PracticeHand, type PracticeStats } from './practice'

const card: React.CSSProperties = {
  background: 'var(--bg-modal-header)', border: '1px solid var(--border)', borderRadius: 10,
  boxShadow: '0 6px 20px rgba(0,0,0,.4)', fontFamily: 'var(--font-ui)', color: 'var(--text-primary, #e9e7e1)',
}

function modeLabel(m: PracticeMode): string {
  return m === 'wait' ? t`Wait for me` : m === 'rhythm' ? t`Play in time` : t`Off`
}

function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { v: T; label: string; icon?: React.ReactNode }[]; onChange: (v: T) => void }) {
  return (
    <div style={{ display: 'flex', gap: 2, padding: 2, background: 'var(--bg-deep, rgba(0,0,0,.25))', border: '1px solid var(--border)', borderRadius: 8 }}>
      {options.map(o => (
        <button key={o.v} onClick={() => onChange(o.v)} aria-pressed={value === o.v}
          style={{
            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, minHeight: 36, padding: '0 8px',
            border: 'none', borderRadius: 6, cursor: 'pointer', fontFamily: 'var(--font-ui)', fontSize: 12.5, fontWeight: 600,
            background: value === o.v ? 'var(--text-amber)' : 'transparent', color: value === o.v ? '#1a1305' : 'var(--text-muted)',
          }}>{o.icon}{o.label}</button>
      ))}
    </div>
  )
}

function ToggleRow({ label, hint, value, onChange }: { label: string; hint: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button role="switch" aria-checked={value} onClick={() => onChange(!value)}
      style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '8px 0', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', fontFamily: 'var(--font-ui)' }}>
      <span style={{ flex: 1 }}>
        <span style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text-primary, #e9e7e1)' }}>{label}</span>
        <span style={{ display: 'block', fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.35, marginTop: 2 }}>{hint}</span>
      </span>
      <span aria-hidden style={{ width: 38, height: 22, borderRadius: 11, flexShrink: 0, position: 'relative', background: value ? 'var(--text-amber)' : 'var(--border)', transition: 'background .15s' }}>
        <span style={{ position: 'absolute', top: 3, left: value ? 19 : 3, width: 16, height: 16, borderRadius: 8, background: value ? '#1a1305' : 'var(--text-muted)', transition: 'left .15s' }} />
      </span>
    </button>
  )
}

const label: React.CSSProperties = { fontSize: 10.5, fontWeight: 700, letterSpacing: '.12em', color: 'var(--text-muted)', margin: '12px 0 6px', textTransform: 'uppercase' }

export function PracticeButton() {
  const mode = usePractice(s => s.mode)
  const hand = usePractice(s => s.hand)
  const accompany = usePractice(s => s.accompany)
  const autoTempo = usePractice(s => s.autoTempo)
  const running = usePractice(s => s.running)
  const bpm = useStore(s => s.bpm)
  const originalBpm = useStore(s => s.originalBpm)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const pct = Math.round((bpm / (originalBpm || bpm || 1)) * 100)

  useEffect(() => {
    if (!open) return
    const close = (e: PointerEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    window.addEventListener('pointerdown', close, true)
    return () => window.removeEventListener('pointerdown', close, true)
  }, [open])

  const p = usePractice.getState()
  const on = mode !== 'off'
  const setTempo = (f: number) => useStore.getState().setBpm(Math.max(1, Math.round(originalBpm * f)))

  return (
    <div ref={ref} style={{ position: 'absolute', top: 12, left: 12, zIndex: 21 }}>
      <button onClick={() => setOpen(o => !o)} aria-expanded={open}
        title={t`Practice: the notes wait for you, or you play along in time`}
        style={{
          ...card, display: 'flex', alignItems: 'center', gap: 7, height: 38, padding: '0 12px', cursor: 'pointer',
          fontSize: 12.5, fontWeight: 700, letterSpacing: '.04em',
          background: on ? 'var(--text-amber)' : 'var(--bg-modal-header)', color: on ? '#1a1305' : 'var(--text-muted)',
          borderColor: on ? 'var(--text-amber)' : 'var(--border)',
        }}>
        <GraduationCap size={17} />
        {t`Practice`}
        <span style={{ fontWeight: 600, opacity: .85 }}>· {modeLabel(mode)}{on ? ` · ${hand === 'L' ? t`Left` : hand === 'R' ? t`Right` : t`Both`}` : ''}</span>
      </button>

      {open && (
        <div style={{ ...card, position: 'absolute', top: 46, left: 0, width: 330, maxWidth: 'calc(100vw - 40px)', padding: '6px 14px 12px', maxHeight: 'calc(100vh - 220px)', overflowY: 'auto' }}>
          <div style={label}>{t`Mode`}</div>
          <Segmented<PracticeMode> value={mode} onChange={p.setMode} options={[
            { v: 'off', label: t`Off`, icon: <Play size={13} /> },
            { v: 'wait', label: t`Wait for me`, icon: <Hourglass size={13} /> },
            { v: 'rhythm', label: t`Play in time`, icon: <Timer size={13} /> },
          ]} />
          <p style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.45, margin: '8px 0 0' }}>
            {mode === 'wait' ? t`The notes stop at the line until you press the right keys. Learn the notes at your own pace.`
              : mode === 'rhythm' ? t`The song runs in tempo. Every note you play is rated: on time, early, late or missed.`
              : t`Normal playback. Choose a practice mode to play along on your keyboard.`}
          </p>

          {on && <>
            <div style={label}>{t`Your hand`}</div>
            <Segmented<PracticeHand> value={hand} onChange={p.setHand} options={[
              { v: 'L', label: t`Left`, icon: <HandIcon size={13} style={{ transform: 'scaleX(-1)' }} /> },
              { v: 'R', label: t`Right`, icon: <HandIcon size={13} /> },
              { v: 'both', label: t`Both` },
            ]} />

            <div style={label}>{t`Tempo`} · {pct} %</div>
            <div style={{ display: 'flex', gap: 6 }}>
              {[0.5, 0.75, 1].map(f => (
                <button key={f} onClick={() => setTempo(f)}
                  style={{ flex: 1, minHeight: 34, borderRadius: 7, cursor: 'pointer', fontFamily: 'var(--font-ui)', fontSize: 12.5, fontWeight: 600,
                    border: '1px solid ' + (Math.abs(pct - f * 100) < 1 ? 'var(--text-amber)' : 'var(--border)'),
                    background: 'transparent', color: Math.abs(pct - f * 100) < 1 ? 'var(--text-amber)' : 'var(--text-muted)' }}>{Math.round(f * 100)} %</button>
              ))}
            </div>

            <div style={{ marginTop: 6 }}>
              <ToggleRow label={t`Play the other parts`} value={accompany} onChange={p.setAccompany}
                hint={t`The app plays the other hand and the other instruments with you.`} />
              <ToggleRow label={t`Speed up automatically`} value={autoTempo} onChange={p.setAutoTempo}
                hint={t`After every pass with at least 90 % right, the tempo goes up by 5 % until the original tempo.`} />
            </div>
            <p style={{ fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.45, margin: '6px 0 0' }}>
              {t`Tip: set a loop to repeat a difficult passage. Press Play to start.`}
            </p>
            {!running && (
              <button onClick={() => { setOpen(false); startPractice() }}
                style={{ marginTop: 10, width: '100%', minHeight: 40, borderRadius: 8, border: 'none', cursor: 'pointer', background: 'var(--text-amber)', color: '#1a1305', fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 13.5, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                <Play size={15} fill="currentColor" strokeWidth={0} />{t`Start practising`}
              </button>
            )}
          </>}
        </div>
      )}
    </div>
  )
}

function judgementText(kind: string): { text: string; color: string } {
  switch (kind) {
    case 'perfect': return { text: t`On time!`, color: 'var(--meter-green, #5fbf6a)' }
    case 'hit': return { text: t`Right!`, color: 'var(--meter-green, #5fbf6a)' }
    case 'early': return { text: t`Early`, color: 'var(--text-amber)' }
    case 'late': return { text: t`Late`, color: 'var(--text-amber)' }
    case 'miss': return { text: t`Missed`, color: 'var(--flag-red, #d9606e)' }
    default: return { text: t`Wrong key`, color: 'var(--flag-red, #d9606e)' }
  }
}

function accuracy(mode: PracticeMode, s: PracticeStats) {
  const total = s.correct + s.wrong + (mode === 'rhythm' ? s.missed : 0)
  return total ? Math.round((s.correct / total) * 100) : null
}

export function PracticeHud() {
  const mode = usePractice(s => s.mode)
  const running = usePractice(s => s.running)
  const waiting = usePractice(s => s.waiting)
  const countdown = usePractice(s => s.countdown)
  const stats = usePractice(s => s.stats)
  const summary = usePractice(s => s.summary)
  const judgement = usePractice(s => s.judgement)
  const [, force] = useState(0)

  // Let the judgement word fade out
  useEffect(() => {
    if (!judgement) return
    const id = setTimeout(() => force(x => x + 1), 900)
    return () => clearTimeout(id)
  }, [judgement])

  if (mode === 'off') return null
  const acc = accuracy(mode, stats)
  const showJudge = judgement && performance.now() - judgement.at < 850
  const j = judgement ? judgementText(judgement.kind) : null

  return (
    <>
      {/* Score */}
      <div style={{ ...card, position: 'absolute', left: 12, top: 58, zIndex: 19, padding: '8px 12px', minWidth: 190, pointerEvents: 'none' }}>
        <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.12em', color: 'var(--text-amber)', textTransform: 'uppercase' }}>
          {modeLabel(mode)}
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginTop: 4, fontSize: 14, fontWeight: 700 }}>
          <span style={{ color: 'var(--meter-green, #5fbf6a)', display: 'inline-flex', alignItems: 'center', gap: 3 }}><Check size={14} />{stats.correct}</span>
          <span style={{ color: 'var(--flag-red, #d9606e)', display: 'inline-flex', alignItems: 'center', gap: 3 }}><X size={14} />{stats.wrong + (mode === 'rhythm' ? stats.missed : 0)}</span>
          <span style={{ marginLeft: 'auto', fontSize: 18 }}>{acc === null ? '–' : `${acc} %`}</span>
        </div>
        {mode === 'rhythm' && (
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3 }}>
            {t`On time`} {stats.perfect} · {t`Early`} {stats.early} · {t`Late`} {stats.late} · {t`Missed`} {stats.missed}
          </div>
        )}
        {stats.streak >= 5 && <div style={{ fontSize: 11, color: 'var(--text-amber)', marginTop: 3 }}>{t`Streak`}: {stats.streak} 🔥</div>}
        {!running && !summary && <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 4 }}>{t`Press Play to start`}</div>}
        {running && waiting && countdown === null && <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 4 }}>{t`Play the lit keys`}</div>}
      </div>

      {/* Judgement */}
      {showJudge && j && (
        <div key={judgement!.at} style={{ position: 'absolute', left: '50%', top: 64, transform: 'translateX(-50%)', zIndex: 19, pointerEvents: 'none',
          fontFamily: 'var(--font-ui)', fontSize: 22, fontWeight: 800, color: j.color, textShadow: '0 2px 10px rgba(0,0,0,.6)', animation: 'pianoooJudge .85s ease-out forwards' }}>
          {j.text}
        </div>
      )}

      {/* Count-in */}
      {running && countdown !== null && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 22, pointerEvents: 'none' }}>
          <div style={{ fontFamily: 'var(--font-ui)', fontSize: 96, fontWeight: 800, color: 'var(--text-amber)', textShadow: '0 4px 24px rgba(0,0,0,.6)' }}>{countdown}</div>
        </div>
      )}

      {/* Result of a pass */}
      {summary && (
        summary.finished ? (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 23, background: 'rgba(0,0,0,.35)' }}>
            <div style={{ ...card, width: 320, maxWidth: 'calc(100% - 32px)', padding: '18px 20px', textAlign: 'center' }}>
              <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: '.1em', color: 'var(--text-amber)', textTransform: 'uppercase' }}>
                {summary.accuracy >= 0.9 ? t`Great!` : summary.accuracy >= 0.7 ? t`Well done!` : t`Keep practising!`}
              </div>
              <div style={{ fontSize: 46, fontWeight: 800, margin: '6px 0 2px' }}>{Math.round(summary.accuracy * 100)} %</div>
              <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
                {t`Correct`} {summary.stats.correct} · {t`Wrong`} {summary.stats.wrong}{summary.mode === 'rhythm' ? ` · ${t`Missed`} ${summary.stats.missed}` : ''}
              </div>
              {summary.mode === 'rhythm' && (
                <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 2 }}>
                  {t`On time`} {summary.stats.perfect} · {t`Early`} {summary.stats.early} · {t`Late`} {summary.stats.late}
                </div>
              )}
              <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 2 }}>{t`Best streak`}: {summary.stats.bestStreak}</div>
              <div style={{ fontSize: 13, marginTop: 8 }}>
                {summary.tempoTo > summary.tempoFrom
                  ? t`Tempo up: ${summary.tempoFrom} % → ${summary.tempoTo} %`
                  : t`Tempo: ${summary.tempoTo} %`}
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                <button onClick={() => usePractice.getState().dismissSummary()}
                  style={{ flex: 1, minHeight: 40, borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', fontFamily: 'var(--font-ui)', fontWeight: 600, cursor: 'pointer' }}>{t`Close`}</button>
                <button onClick={() => { stopPractice(); useStore.setState({ currentTime: useStore.getState().loopStart ?? 0 }); startPractice() }}
                  style={{ flex: 1, minHeight: 40, borderRadius: 8, border: 'none', background: 'var(--text-amber)', color: '#1a1305', fontFamily: 'var(--font-ui)', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                  <RotateCcw size={15} />{t`Again`}</button>
              </div>
            </div>
          </div>
        ) : (
          <div style={{ ...card, position: 'absolute', left: 12, top: 150, zIndex: 19, padding: '7px 12px', fontSize: 12.5 }}
            onClick={() => usePractice.getState().dismissSummary()}>
            {t`Last pass`}: <b>{Math.round(summary.accuracy * 100)} %</b>
            {summary.tempoTo > summary.tempoFrom ? <> · {t`Tempo up: ${summary.tempoFrom} % → ${summary.tempoTo} %`}</> : null}
          </div>
        )
      )}
      <style>{`@keyframes pianoooJudge{0%{opacity:0;transform:translate(-50%,8px) scale(.9)}15%{opacity:1;transform:translate(-50%,0) scale(1.05)}100%{opacity:0;transform:translate(-50%,-14px) scale(1)}}`}</style>
    </>
  )
}
