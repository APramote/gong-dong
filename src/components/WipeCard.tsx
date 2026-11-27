import { useState } from 'react'
import { db } from '../db/db'
import { repo } from '../db/repo'
import { DEFAULT_GOOGLE_CLIENT_ID, loadSettings, saveSettings } from '../lib/settings'
import { t } from '../th'

type Msg = { ok: boolean; text: string } | null

/** ล้างข้อมูล: เฉพาะสถิติการอ่าน หรือทั้งหมด (เลือกลบสำเนาใน Google Drive ด้วยได้) */
export function WipeCard() {
  const [open, setOpen] = useState(false)
  const [word, setWord] = useState('')
  const [drive, setDrive] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<Msg>(null)
  const signedIn = Boolean(loadSettings().googleAccount)

  async function clearStats() {
    if (!confirm(t.wipe.confirmStats)) return
    setMsg({ ok: true, text: t.wipe.statsDone(await repo.clearStats()) })
  }

  async function wipeAll() {
    if (word.trim() !== t.wipe.word || busy) return
    setBusy(true)
    setMsg(null)
    try {
      const { wipeLocal, wipeRemote } = await import('../lib/sync')
      let files = 0
      if (drive) {
        // ลบใน Drive ก่อน ถ้าไม่สำเร็จจะยังไม่แตะข้อมูลในเครื่อง
        const s = loadSettings()
        const { connect, driveStore } = await import('../lib/drive')
        // ต้องเป็นบัญชีเดียวกับที่แสดงว่าเชื่อมอยู่ ไม่อย่างนั้นไม่ลบ
        const { token } = await connect(s.googleClientId || DEFAULT_GOOGLE_CLIENT_ID, s.googleAccount)
        files = await wipeRemote(driveStore(token))
      }
      await wipeLocal(db)
      saveSettings({ ...loadSettings(), lastSyncAt: 0 })
      setMsg({ ok: true, text: drive ? t.wipe.allDoneDrive(files) : t.wipe.allDone })
      setOpen(false)
      setWord('')
    } catch (e) {
      const kind = (e as { kind?: string })?.kind ?? 'other'
      setMsg({
        ok: false,
        text:
          kind === 'wrong-account'
            ? t.sync.wrongAccount((e as Error).message)
            : (t.sync.errors[kind as keyof typeof t.sync.errors] ?? t.sync.errors.other),
      })
    }
    setBusy(false)
  }

  return (
    <section className="form card" id="wipe">
      <h2>{t.wipe.title}</h2>
      <p className="muted">
        {t.wipe.lead} · {t.wipe.backupFirst}
      </p>

      <div>
        <button type="button" className="btn" onClick={clearStats}>
          {t.wipe.stats}
        </button>
        <p className="muted">{t.wipe.statsHint}</p>
      </div>

      <div>
        {!open ? (
          <button type="button" className="btn danger" onClick={() => setOpen(true)}>
            {t.wipe.all}
          </button>
        ) : (
          <form
            className="form inline-form"
            onSubmit={(e) => {
              e.preventDefault()
              wipeAll()
            }}
          >
            <strong>{t.wipe.all}</strong>
            <p className="muted">{t.wipe.allHint}</p>
            {signedIn && (
              <>
                <label className="check">
                  <input type="checkbox" checked={drive} onChange={(e) => setDrive(e.target.checked)} />
                  {t.wipe.alsoDrive}
                </label>
                <p className="muted">{drive ? t.wipe.otherDevices : t.wipe.alsoDriveHint}</p>
              </>
            )}
            <label className="narrow">
              {t.wipe.typeToConfirm}
              <input value={word} autoFocus autoCapitalize="off" autoCorrect="off" onChange={(e) => setWord(e.target.value)} />
            </label>
            <div className="actions">
              <button type="submit" className="btn danger" disabled={word.trim() !== t.wipe.word || busy}>
                {busy ? t.wipe.wiping : t.wipe.confirmAll}
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setOpen(false)
                  setWord('')
                }}
              >
                {t.common.cancel}
              </button>
            </div>
          </form>
        )}
        {!open && <p className="muted">{t.wipe.allHint}</p>}
      </div>

      {msg && (
        <p className={msg.ok ? 'ok' : 'error'} role={msg.ok ? 'status' : 'alert'}>
          {msg.text}
        </p>
      )}
    </section>
  )
}
