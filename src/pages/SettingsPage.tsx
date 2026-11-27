import { useState } from 'react'
import { aiErrorText } from '../lib/aiError'
import { checkClaudeKey, listGeminiModels } from '../lib/ai'
import { CLAUDE_MODELS } from '../lib/claudeModels'
import { pickDefaultModel } from '../lib/gemini'
import { loadSettings, saveSettings, type Provider, type Settings } from '../lib/settings'
import { t } from '../th'
import { SyncCard } from '../components/SyncCard'
import { WipeCard } from '../components/WipeCard'

type Status = { ok: boolean; text: string } | null

export function SettingsPage() {
  const [settings, setSettings] = useState(loadSettings)
  const [geminiModels, setGeminiModels] = useState<string[]>(
    settings.geminiModel ? [settings.geminiModel] : [],
  )
  const [status, setStatus] = useState<Status>(null)
  const [busy, setBusy] = useState(false)

  const update = (patch: Partial<Settings>) => {
    // อ่านค่าล่าสุดจากเครื่องก่อนรวม (การ์ดซิงก์บันทึกบัญชีและเวลาซิงก์แยกต่างหาก ต้องไม่ถูกทับด้วยค่าเก่า)
    const next = { ...loadSettings(), ...patch }
    setSettings(next)
    saveSettings(next)
  }

  async function checkGemini() {
    const key = settings.geminiKey.trim()
    setBusy(true)
    setStatus(null)
    try {
      const ids = await listGeminiModels(key)
      setGeminiModels(ids)
      const model = ids.includes(settings.geminiModel) ? settings.geminiModel : pickDefaultModel(ids)
      update({ geminiKey: key, geminiModel: model })
      setStatus({ ok: true, text: t.settings.ok(ids.length) })
    } catch (e) {
      update({ geminiKey: key })
      setStatus({ ok: false, text: aiErrorText(e) })
    } finally {
      setBusy(false)
    }
  }

  async function checkClaude() {
    const key = settings.claudeKey.trim()
    update({ claudeKey: key })
    setBusy(true)
    setStatus(null)
    try {
      await checkClaudeKey(key, settings.claudeModel)
      setStatus({ ok: true, text: t.settings.claudeOk })
    } catch (e) {
      setStatus({ ok: false, text: aiErrorText(e) })
    } finally {
      setBusy(false)
    }
  }

  const isClaude = settings.provider === 'claude'
  const key = isClaude ? settings.claudeKey : settings.geminiKey
  const claudeModel = CLAUDE_MODELS.find((m) => m.id === settings.claudeModel)

  const providerOption = (value: Provider, title: string, hint: string) => (
    <label className="radio">
      <input
        type="radio"
        name="provider"
        checked={settings.provider === value}
        onChange={() => {
          update({ provider: value })
          setStatus(null)
        }}
      />
      <span>
        <span className="row-title">{title}</span>
        <span className="row-sub">{hint}</span>
      </span>
    </label>
  )

  return (
    <div className="form">
      <h1>{t.settings.title}</h1>
      {/* บัญชีและการซิงก์อยู่บนสุด หาเจอทันทีที่เปิดหน้าตั้งค่า */}
      <SyncCard />
      <label className="switch-row">
        <input
          type="checkbox"
          role="switch"
          checked={settings.aiEnabled}
          onChange={(e) => {
            update({ aiEnabled: e.target.checked })
            setStatus(null)
          }}
        />
        <span>
          <span className="row-title">{t.settings.aiEnabled}</span>
          <span className="row-sub">{t.settings.aiEnabledHint}</span>
        </span>
      </label>
      {!settings.aiEnabled && <p className="muted">{t.settings.aiOffNow}</p>}
      {settings.aiEnabled && (
      <>
      <fieldset className="fieldset">
        <legend>{t.settings.provider}</legend>
        {providerOption('gemini', t.settings.gemini, t.settings.geminiHint)}
        {providerOption('claude', t.settings.claude, t.settings.claudeHint)}
      </fieldset>

      <label>
        {t.settings.keyLabel}
        <input
          type="password"
          autoComplete="off"
          value={key}
          onChange={(e) =>
            update(isClaude ? { claudeKey: e.target.value } : { geminiKey: e.target.value })
          }
        />
      </label>
      <p className="muted">{isClaude ? t.settings.claudeKeyHint : t.settings.geminiKeyHint}</p>

      {isClaude ? (
        <label>
          {t.settings.model}
          <select value={settings.claudeModel} onChange={(e) => update({ claudeModel: e.target.value })}>
            {CLAUDE_MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
          {claudeModel && (
            <span className="muted">
              {t.settings.price(claudeModel.price)} · {t.settings.searchCost}
            </span>
          )}
        </label>
      ) : (
        <label>
          {t.settings.model}
          <select
            value={settings.geminiModel}
            disabled={geminiModels.length === 0}
            onChange={(e) => update({ geminiModel: e.target.value })}
          >
            {geminiModels.length === 0 && <option value="">{t.settings.modelNone}</option>}
            {geminiModels.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
      )}

      {status && <p className={status.ok ? 'ok' : 'error'}>{status.text}</p>}
      <div className="actions">
        <button
          className="btn primary"
          disabled={busy || !key.trim()}
          onClick={isClaude ? checkClaude : checkGemini}
        >
          {busy ? t.settings.checking : t.settings.check}
        </button>
        {key && (
          <button
            className="btn danger"
            onClick={() => {
              if (isClaude) update({ claudeKey: '' })
              else {
                update({ geminiKey: '', geminiModel: '' })
                setGeminiModels([])
              }
              setStatus(null)
            }}
          >
            {t.settings.clear}
          </button>
        )}
      </div>
      </>
      )}
      <WipeCard />
    </div>
  )
}
