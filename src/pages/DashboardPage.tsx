import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { repo } from '../db/repo'
import type { Book } from '../db/types'
import { CoverThumb } from '../components/Cover'
import {
  ChartCard,
  ColumnChart,
  Legend,
  Meter,
  RankedBars,
  SegmentedBar,
  StatTile,
  TableView,
} from '../components/charts'
import { aiReady, askJson } from '../lib/ai'
import { aiErrorText } from '../lib/aiError'
import {
  coachPrompt,
  coachSchema,
  dashboard,
  motivation,
  readCoach,
  WEEKDAYS,
  WEEKDAYS_SHORT,
  type Coach,
} from '../lib/dashboard'
import { loadSettings, saveSettings } from '../lib/settings'
import { formatMinutes } from '../lib/stats'
import { t } from '../th'

const S1 = 'var(--series-1)'
const S2 = 'var(--series-2)'

const shortDate = (day: string) =>
  new Date(`${day}T12:00:00`).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })
const shortMonth = (month: string) =>
  new Date(`${month}-15T12:00:00`).toLocaleDateString('th-TH', { month: 'short' })
/**
 * แกนเวลาใช้หน่วยเดียวทั้งแกน: เป็นนาที หรือเป็นชั่วโมงเมื่อค่าสูงสุดเกิน 90 นาที
 * กล่องลอยแสดงเวลาเต็มเช่น "1 ชม. 20 นาที"
 */
function timeAxis(raw: number[]) {
  const hours = Math.max(0, ...raw) > 90
  const round = (v: number) => Math.round(v * 10) / 10
  return {
    values: hours ? raw.map((v) => v / 60) : raw,
    format: hours ? (v: number) => `${round(v)} ชม.` : (v: number) => `${Math.round(v)} นาที`,
    tipFormat: (v: number) => formatMinutes(Math.round(hours ? v * 60 : v)),
  }
}

function NextBook({ book, note }: { book: Book; note: string }) {
  const navigate = useNavigate()
  return (
    <li className="row">
      <CoverThumb bookId={book.id} />
      <Link to={`/book/${book.id}`} className="row-main">
        <span className="row-title">{book.title}</span>
        <span className="row-sub">{note}</span>
      </Link>
      <button
        className="btn small"
        aria-label={`${t.reading.take} ${book.title}`}
        onClick={async () => {
          await repo.takeBook(book.id)
          navigate('/reading')
        }}
      >
        {t.reading.takeShort}
      </button>
    </li>
  )
}

export function DashboardPage() {
  const books = useLiveQuery(() => repo.listBooks(), [])
  const sessions = useLiveQuery(() => repo.listSessions(), []) ?? []
  const categories = useLiveQuery(() => repo.listCategories(), []) ?? []
  const [settings, setSettings] = useState(loadSettings)
  const [editing, setEditing] = useState(false)
  const [coach, setCoach] = useState<Coach | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const d = useMemo(() => dashboard(books ?? [], sessions, Date.now(), categories), [books, sessions, categories])
  if (!books) return null
  const goals = { dailyMinutes: settings.dailyGoalMinutes, yearBooks: settings.yearGoalBooks }
  const byId = new Map(books.map((b) => [b.id, b]))
  const setGoal = (patch: Partial<typeof settings>) => {
    const next = { ...settings, ...patch }
    setSettings(next)
    saveSettings(next)
  }

  async function askCoach() {
    setBusy(true)
    setError('')
    try {
      const dong = books!.filter((b) => b.status === 'dong' && !b.takenAt)
      const { prompt, codes } = coachPrompt(d, goals, dong, categories)
      setCoach(readCoach(await askJson(prompt, coachSchema), codes))
    } catch (e) {
      setError(aiErrorText(e))
    } finally {
      setBusy(false)
    }
  }

  const hasHistory = d.sessions > 0
  const dailyAxis = timeAxis(d.daily.map((x) => x.minutes))
  const hourAxis = timeAxis(d.byHour)
  const weekdayAxis = timeAxis(d.byWeekday)
  const status = [
    { name: t.status.dong, value: d.status.dong, color: 'var(--series-1)', ink: '#ffffff' },
    { name: t.status.reading, value: d.status.reading, color: 'var(--series-2)', ink: '#191919' },
    { name: t.status.done, value: d.status.done, color: 'var(--series-3)', ink: '#191919' },
    { name: t.status.dropped, value: d.status.dropped, color: 'var(--series-4)', ink: '#191919' },
  ]

  return (
    <div className="dash">
      <div className="page-head">
        <h1>{t.dash.title}</h1>
        <button className="btn small" onClick={() => setEditing((e) => !e)}>
          {t.dash.editGoals}
        </button>
      </div>

      {editing && (
        <div className="inline-form form">
          <div className="cols">
            <label>
              {t.dash.dailyGoal}
              <input
                inputMode="numeric"
                value={settings.dailyGoalMinutes}
                onChange={(e) => setGoal({ dailyGoalMinutes: Math.max(1, parseInt(e.target.value, 10) || 1) })}
              />
            </label>
            <label>
              {t.dash.yearGoal}
              <input
                inputMode="numeric"
                value={settings.yearGoalBooks}
                onChange={(e) => setGoal({ yearGoalBooks: Math.max(1, parseInt(e.target.value, 10) || 1) })}
              />
            </label>
          </div>
        </div>
      )}

      <div className="stats">
        <StatTile label={t.dash.dong} value={t.dash.books(d.status.dong)} />
        <StatTile label={t.dash.streak} value={t.dash.days(d.streak)} sub={t.dash.best(d.bestStreak)} />
        <StatTile label={t.dash.week} value={formatMinutes(d.weekMinutes)} />
      </div>

      <section className="goals">
        <h2>{t.dash.goals}</h2>
        <Meter
          label={t.dash.today}
          value={d.todayMinutes}
          max={goals.dailyMinutes}
          text={t.dash.of(formatMinutes(d.todayMinutes), formatMinutes(goals.dailyMinutes))}
        />
        <Meter
          label={t.dash.thisYear}
          value={d.finishedYear}
          max={goals.yearBooks}
          text={t.dash.of(String(d.finishedYear), t.dash.books(goals.yearBooks))}
        />
      </section>

      <section>
        <h2>{t.dash.motivation}</h2>
        <ul className="motivation">
          {motivation(d, goals).map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      </section>

      {!hasHistory && <p className="empty">{t.dash.empty}</p>}

      {hasHistory && (
        <section className="charts">
          <ChartCard title={t.dash.daily}>
            <p className="muted">{t.dash.sessions(d.sessions, formatMinutes(d.avgMinutes), d.avgPages)}</p>
            <ColumnChart
              label={t.dash.daily}
              labels={d.daily.map((x) => shortDate(x.day))}
              series={[{ name: t.dash.minutes, color: S1, values: dailyAxis.values }]}
              format={dailyAxis.format}
              tipFormat={dailyAxis.tipFormat}
              tickLabel={(i) => (i % 7 === 1 || i === 29 ? shortDate(d.daily[i].day) : '')}
            />
            <TableView head={[t.dash.date, t.dash.minutes]} rows={d.daily.map((x) => [shortDate(x.day), x.minutes])} />
          </ChartCard>

          <ChartCard title={t.dash.hours}>
            <ColumnChart
              label={t.dash.hours}
              labels={d.byHour.map((_, h) => `${String(h).padStart(2, '0')}:00`)}
              series={[{ name: t.dash.minutes, color: S1, values: hourAxis.values }]}
              format={hourAxis.format}
              tipFormat={hourAxis.tipFormat}
              tickLabel={(h) => (h % 6 === 0 ? `${String(h).padStart(2, '0')}:00` : '')}
              height={130}
            />
            <TableView
              head={[t.dash.hour, t.dash.minutes]}
              rows={d.byHour.map((v, h) => [`${String(h).padStart(2, '0')}:00`, v]).filter((r) => Number(r[1]) > 0)}
            />
          </ChartCard>

          <ChartCard title={t.dash.weekdays}>
            <ColumnChart
              label={t.dash.weekdays}
              labels={WEEKDAYS}
              series={[{ name: t.dash.minutes, color: S1, values: weekdayAxis.values }]}
              format={weekdayAxis.format}
              tipFormat={weekdayAxis.tipFormat}
              tickLabel={(i) => WEEKDAYS_SHORT[i]}
              height={130}
            />
            <TableView head={[t.dash.weekday, t.dash.minutes]} rows={WEEKDAYS.map((w, i) => [w, d.byWeekday[i]])} />
          </ChartCard>
        </section>
      )}

      <section className="charts">
        <ChartCard title={t.dash.monthly}>
          <Legend
            items={[
              { name: t.dash.finished, color: S1 },
              { name: t.dash.added, color: S2 },
            ]}
          />
          <ColumnChart
            label={t.dash.monthly}
            labels={d.monthly.map((m) => shortMonth(m.month))}
            series={[
              { name: t.dash.finished, color: S1, values: d.monthly.map((m) => m.finished) },
              { name: t.dash.added, color: S2, values: d.monthly.map((m) => m.added) },
            ]}
            format={(v) => String(Math.round(v))}
            tipFormat={(v) => t.dash.books(v)}
            tickLabel={(i) => (i % 2 === 1 ? shortMonth(d.monthly[i].month) : '')}
          />
          <TableView
            head={[t.dash.month, t.dash.finished, t.dash.added]}
            rows={d.monthly.map((m) => [shortMonth(m.month), m.finished, m.added])}
          />
        </ChartCard>

        {books.length > 0 && (
          <ChartCard title={t.dash.status}>
            <SegmentedBar label={t.dash.status} parts={status} />
          </ChartCard>
        )}

        {books.length > 0 && (
          <ChartCard title={t.dash.categories}>
            <RankedBars items={d.categories.map((c) => ({ name: c.name, value: c.count }))} format={t.dash.books} />
          </ChartCard>
        )}
      </section>

      {(d.oldestDong || d.shortestDong) && (
        <section>
          <h2>{t.dash.next}</h2>
          <ul className="list">
            {d.oldestDong && (
              <NextBook
                book={d.oldestDong}
                note={t.dash.oldest(new Date(d.oldestDong.createdAt).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' }))}
              />
            )}
            {d.shortestDong && d.shortestDong.id !== d.oldestDong?.id && (
              <NextBook book={d.shortestDong} note={t.dash.shortest(d.shortestDong.pages!)} />
            )}
          </ul>
        </section>
      )}

      <section>
        <h2>{t.dash.coach}</h2>
        <p className="muted">{t.dash.coachHint}</p>
        {error && <p className="error">{error}</p>}
        {!coach && (
          <button className="btn primary" disabled={busy || !aiReady()} onClick={askCoach}>
            {busy ? t.dash.coachBusy : t.dash.coachRun}
          </button>
        )}
        {!aiReady() && (
          <p className="muted">
            {t.add.needKey}{' '}
            <Link to="/settings" className="link">
              {t.add.goSettings}
            </Link>
          </p>
        )}
        {coach && (
          <div className="plan">
            {coach.headline && <p className="coach-headline">{coach.headline}</p>}
            {coach.insights.length > 0 && (
              <div className="card">
                <h3>{t.dash.insights}</h3>
                <ul className="tips">
                  {coach.insights.map((x) => (
                    <li key={x}>{x}</li>
                  ))}
                </ul>
              </div>
            )}
            {coach.tips.length > 0 && (
              <div className="card">
                <h3>{t.dash.tips}</h3>
                <ul className="tips">
                  {coach.tips.map((x) => (
                    <li key={x}>{x}</li>
                  ))}
                </ul>
              </div>
            )}
            {coach.picks.length > 0 && (
              <div className="card">
                <h3>{t.dash.picks}</h3>
                <ul className="list">
                  {coach.picks
                    .filter((p) => byId.get(p.bookId))
                    .map((p) => (
                      <NextBook key={p.bookId} book={byId.get(p.bookId)!} note={p.reason} />
                    ))}
                </ul>
              </div>
            )}
            <button className="btn" onClick={() => setCoach(null)}>
              {t.common.cancel}
            </button>
          </div>
        )}
      </section>
    </div>
  )
}
