import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { Link } from 'react-router-dom'
// Language switch hidden for now.
// import { LanguageToggle } from '../components/LanguageToggle'
import { useT } from '../i18n'
import '../styles/pages/landing.css'

interface Example {
  value: string
  table: string
  col: string
  row: number
  pills: string[]
  grid: string[][]
  hot: [number, number] // [row, col] of the cell in question
  error: boolean
}

const EXAMPLES: Example[] = [
  {
    value: 'Hamburg 1,5',
    table: 'beers_split_2',
    col: 'city',
    row: 41,
    pills: ['Typo Detector', 'Outlier Detector'],
    grid: [['Pale Ale', 'Hamburg', '5.2'], ['Stout', 'Hamburg 1,5', '6.1'], ['Lager', 'Berlin', '4.8']],
    hot: [1, 1],
    error: true,
  },
  {
    value: 'Berlin',
    table: 'beers_split_1',
    col: 'city',
    row: 7,
    pills: ['Outlier Detector'],
    grid: [['IPA', 'Munich', '6.8'], ['Lager', 'Berlin', '4.8'], ['Porter', 'Bremen', '5.5']],
    hot: [1, 1],
    error: false,
  },
  {
    value: '25:61',
    table: 'flights_split_3',
    col: 'dep_time',
    row: 112,
    pills: ['Rule Violation Detector', 'Outlier Detector'],
    grid: [['LH 402', '08:15', '10:40'], ['LH 118', '25:61', '13:05'], ['AF 1234', '11:30', '13:55']],
    hot: [1, 1],
    error: true,
  },
  {
    value: '5.2',
    table: 'beers_split_3',
    col: 'abv',
    row: 23,
    pills: ['Outlier Detector'],
    grid: [['Pils', 'Hamburg', '4.9'], ['Pale Ale', 'Hamburg', '5.2'], ['Stout', 'Cologne', '6.1']],
    hot: [1, 2],
    error: false,
  },
  {
    value: 'Mercy Hospitl',
    table: 'hospital_split_1',
    col: 'name',
    row: 64,
    pills: ['Typo Detector'],
    grid: [['Mercy Hospital', 'Ohio', 'Acute'], ['Mercy Hospitl', 'Ohio', 'Acute'], ['St. Luke', 'Texas', 'Acute']],
    hot: [1, 0],
    error: true,
  },
  {
    value: 'Texas',
    table: 'hospital_split_2',
    col: 'state',
    row: 9,
    pills: ['Rule Violation Detector'],
    grid: [['St. Luke', 'Texas', 'Acute'], ['Riverside', 'Texas', 'Rehab'], ['Mercy', 'Ohio', 'Acute']],
    hot: [0, 1],
    error: false,
  },
]

const HOLD_MS = 2600 // how long a card is shown before it is judged
const LEAVE_MS = 520

function Mark({ kind }: { kind: 'ok' | 'err' }) {
  return (
    <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true" focusable="false">
      <path
        d={kind === 'ok' ? 'M5 12.5l4.5 4.5L19 7.5' : 'M6 6l12 12M18 6L6 18'}
        fill="none"
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** A stack of example cards that judges itself in a loop, with the buttons it would press. */
function DemoCard() {
  const [index, setIndex] = useState(0)
  const [leaving, setLeaving] = useState(false)
  const card = EXAMPLES[index % EXAMPLES.length]

  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    const hold = window.setTimeout(() => setLeaving(true), HOLD_MS)
    const next = window.setTimeout(() => {
      setLeaving(false)
      setIndex((i) => i + 1)
    }, HOLD_MS + LEAVE_MS)
    return () => {
      window.clearTimeout(hold)
      window.clearTimeout(next)
    }
  }, [index])

  const verdict = card.error ? 'err' : 'ok'
  return (
    <div className="lp-demo" aria-hidden="true">
      <div className="lp-stage">
        <div className="lp-card lp-card-back lp-card-b2" />
        <div className="lp-card lp-card-back lp-card-b1" />
        <div key={index} className={`lp-card lp-card-top${leaving ? ` lp-go-${verdict}` : ''}`}>
          <span className="lp-stamp lp-stamp-ok">CORRECT</span>
          <span className="lp-stamp lp-stamp-err">ERROR</span>
          <p className="lp-card-value">{card.value}</p>
          <p className="lp-card-meta">
            <code>{card.table}</code> · column <code>{card.col}</code> · row {card.row}
          </p>
          <div className="lp-pills">
            {card.pills.map((p) => (
              <span key={p} className="lp-pill">
                {p}
              </span>
            ))}
          </div>
          <table className="lp-mini">
            <tbody>
              {card.grid.map((row, r) => (
                <tr key={r}>
                  {row.map((cell, c) => (
                    <td key={c} className={r === card.hot[0] && c === card.hot[1] ? 'lp-hot' : undefined}>
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="lp-buttons">
        <span className={`lp-round lp-round-err${leaving && verdict === 'err' ? ' lp-pressed' : ''}`}>
          <Mark kind="err" />
        </span>
        <span className={`lp-round lp-round-ok${leaving && verdict === 'ok' ? ' lp-pressed' : ''}`}>
          <Mark kind="ok" />
        </span>
      </div>
    </div>
  )
}

export function Landing() {
  const tt = useT().landing
  return (
    <main className="lp">
      <section className="lp-hero">
        {/* Language switch hidden for now.
        <LanguageToggle className="lp-lang" />
        */}
        <div className="lp-hero-copy">
          <p className="lp-title lp-in" style={{ '--i': 0 } as CSSProperties}>
            Matelda
          </p>
          <h1 className="lp-in" style={{ '--i': 1 } as CSSProperties}>
            {tt.headline}
            <br />
            <span className="lp-gradient">{tt.headlineAccent}</span>
          </h1>
          <p className="lp-lead lp-in" style={{ '--i': 2 } as CSSProperties}>
            {tt.lead}
          </p>
          <div className="lp-cta-row lp-in" style={{ '--i': 3 } as CSSProperties}>
            <Link className="lp-cta" to="/lobby">
              {tt.cta}
              <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
                <path d="M5 12h14M13 6l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </Link>
          </div>
        </div>
        <DemoCard />
      </section>
    </main>
  )
}
