import { useState } from 'react'
import { GeminiError, listModels, pickDefaultModel } from '../lib/gemini'
import { loadSettings, saveSettings } from '../lib/settings'
import { t } from '../th'

export function SettingsPage() {
  const [settings, setSettings] = useState(loadSettings)
  const [models, setModels] = useState<string[]>(settings.geminiModel ? [settings.geminiModel] : [])
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const update = (patch: Partial<typeof settings>) => {
    const next = { ...settings, ...patch }
    setSettings(next)
    saveSettings(next)
  }

  async function check() {
    const key = settings.geminiKey.trim()
    setBusy(true)
    setStatus(null)
    try {
      const ids = await listModels(key)
      setModels(ids)
      const model = ids.includes(settings.geminiModel) ? settings.geminiModel : pickDefaultModel(ids)
      update({ geminiKey: key, geminiModel: model })
      setStatus({ ok: true, text: t.settings.ok(ids.length) })
    } catch (e) {
      update({ geminiKey: key })
      setStatus({ ok: false, text: t.ai[e instanceof GeminiError ? e.kind : 'other'] })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="form">
      <h1>{t.settings.title}</h1>
      <h2>{t.settings.gemini}</h2>
      <label>
        {t.settings.keyLabel}
        <input
          type="password"
          autoComplete="off"
          value={settings.geminiKey}
          onChange={(e) => update({ geminiKey: e.target.value })}
        />
      </label>
      <p className="muted">{t.settings.keyHint}</p>
      <label>
        {t.settings.model}
        <select
          value={settings.geminiModel}
          disabled={models.length === 0}
          onChange={(e) => update({ geminiModel: e.target.value })}
        >
          {models.length === 0 && <option value="">{t.settings.modelNone}</option>}
          {models.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </label>
      {status && <p className={status.ok ? 'ok' : 'error'}>{status.text}</p>}
      <div className="actions">
        <button className="btn primary" disabled={busy || !settings.geminiKey.trim()} onClick={check}>
          {busy ? t.settings.checking : t.settings.check}
        </button>
        {settings.geminiKey && (
          <button
            className="btn danger"
            onClick={() => {
              update({ geminiKey: '', geminiModel: '' })
              setModels([])
              setStatus(null)
            }}
          >
            {t.settings.clear}
          </button>
        )}
      </div>
    </div>
  )
}
