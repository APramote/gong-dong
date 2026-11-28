import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { getSettingsVersion, getSharedAt, subscribe } from '../lib/autosync'
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
  /** ค่าที่บันทึกไว้ล่าสุดเท่าที่หน้านี้รู้ ใช้ดูว่าช่อง key ถูกพิมพ์ค้างอยู่หรือไม่ */
  const saved = useRef(settings)
  const [geminiModels, setGeminiModels] = useState<string[]>(
    settings.geminiModel ? [settings.geminiModel] : [],
  )
  const [status, setStatus] = useState<Status>(null)
  const [busy, setBusy] = useState(false)
  // ซิงก์แล้วได้การตั้งค่าใหม่จากเครื่องอื่น (เช่น API key): แสดงค่าใหม่ทันที ไม่ต้องเปิดหน้านี้ใหม่
  const pulled = useSyncExternalStore(subscribe, getSettingsVersion)
  // การตั้งค่าเปลี่ยนจากที่อื่นด้วย (แท็บอื่นแก้หรือซิงก์): อ่านใหม่เช่นกัน
  const sharedAt = useSyncExternalStore(subscribe, getSharedAt)
  const seen = useRef(pulled)
  const seenAt = useRef(sharedAt)
  useEffect(() => {
    // เฉพาะการเปลี่ยนที่เกิดขณะเปิดหน้านี้อยู่ (ไม่ใช่ครั้งที่เกิดก่อนเข้าหน้า)
    const fromSync = pulled !== seen.current
    if (!fromSync && sharedAt === seenAt.current) return
    seen.current = pulled
    seenAt.current = sharedAt
    const s = loadSettings()
    // หน้านี้เพิ่งบันทึกค่านี้เอง ไม่ต้องอ่านซ้ำ
    if (!fromSync && s.sharedAt === saved.current.sharedAt) return
    // กำลังพิมพ์ key ค้างอยู่ (ต่างจากที่บันทึกไว้ก่อนหน้า): ไม่ทับสิ่งที่พิมพ์
    setSettings((cur) => ({
      ...s,
      geminiKey: cur.geminiKey !== saved.current.geminiKey ? cur.geminiKey : s.geminiKey,
      claudeKey: cur.claudeKey !== saved.current.claudeKey ? cur.claudeKey : s.claudeKey,
    }))
    saved.current = s
    setGeminiModels((m) => (s.geminiModel && !m.includes(s.geminiModel) ? [...m, s.geminiModel] : m))
    if (fromSync) setStatus({ ok: true, text: t.settings.pulled })
  }, [pulled, sharedAt])

  const update = (patch: Partial<Settings>) => {
    // อ่านค่าล่าสุดจากเครื่องก่อนรวม (การ์ดซิงก์บันทึกบัญชีและเวลาซิงก์แยกต่างหาก ต้องไม่ถูกทับด้วยค่าเก่า)
    const next = { ...loadSettings(), ...patch }
    saveSettings(next)
    saved.current = loadSettings()
    // key ที่พิมพ์ค้างไว้ (ยังไม่ได้กดบันทึก) ยังอยู่ในช่อง ไม่ถูกแทนด้วยค่าที่บันทึกไว้
    setSettings((cur) => ({ ...loadSettings(), geminiKey: patch.geminiKey ?? cur.geminiKey, claudeKey: patch.claudeKey ?? cur.claudeKey }))
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
          onChange={(e) => {
            // พิมพ์แล้วยังไม่บันทึก: บันทึกเมื่อกด "บันทึกและตรวจสอบ key" เท่านั้น key ที่พิมพ์ไม่ครบจะได้ไม่ถูกซิงก์ไปทับเครื่องอื่น
            const v = e.target.value
            setSettings((cur) => ({ ...cur, ...(isClaude ? { claudeKey: v } : { geminiKey: v }) }))
          }}
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
              if (!confirm(t.settings.confirmClear)) return
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
