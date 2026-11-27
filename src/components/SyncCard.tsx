import { useRef, useState } from 'react'
import { db } from '../db/db'
import { download } from '../lib/download'
import { DEFAULT_GOOGLE_CLIENT_ID, loadSettings, saveSettings } from '../lib/settings'
import { dayKey, timeAgo } from '../lib/stats'
import { t } from '../th'

type Msg = { ok: boolean; text: string } | null

/** ข้อความภาษาไทยของข้อผิดพลาดตอน sync */
function errorText(e: unknown): string {
  const message = (e as Error)?.message ?? ''
  const kind = (e as { kind?: string })?.kind ?? (message === 'bad-file' ? 'bad-file' : 'other')
  const text = t.sync.errors[kind as keyof typeof t.sync.errors] ?? t.sync.errors.other
  // สาเหตุที่ไม่รู้จัก: แนบรายละเอียดจาก Google ไว้ให้ส่งมาถามได้ (ไม่มีโทเคนหรือข้อมูลส่วนตัวในข้อความนี้)
  return kind === 'other' && message && message !== 'other' ? `${text} (${message})` : text
}

/** ซิงก์กับ Google Drive และสำรอง/กู้คืนเป็นไฟล์ */
export function SyncCard() {
  const [s, setS] = useState(loadSettings)
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState<Msg>(null)
  const [withCovers, setWithCovers] = useState(true)
  const picker = useRef<HTMLInputElement>(null)
  const update = (patch: Partial<typeof s>) => {
    const next = { ...loadSettings(), ...patch }
    saveSettings(next)
    setS(next)
  }

  /** เข้าสู่ระบบ (ถ้ายังไม่เข้า) แล้วซิงก์ทันที */
  async function sync() {
    setMsg(null)
    setBusy(s.googleAccount ? t.sync.syncing : t.sync.signingIn)
    try {
      // โหลดโค้ด sync เฉพาะเมื่อใช้ และขอสิทธิ์จาก Google ในจังหวะกดปุ่ม (ไม่งั้นหน้าต่างถูกบล็อก)
      const [{ signIn, driveStore, account }, { syncAll }] = await Promise.all([import('../lib/drive'), import('../lib/sync')])
      const token = await signIn(s.googleClientId || DEFAULT_GOOGLE_CLIENT_ID, s.googleAccount)
      const who = await account(token)
      update({ googleAccount: who.email })
      setBusy(t.sync.syncing)
      const r = await syncAll(db, driveStore(token), (done, total) => setBusy(t.sync.covers(done, total)))
      update({ lastSyncAt: Date.now() })
      setMsg({ ok: true, text: t.sync.done(r.pushed, r.pulled) })
    } catch (e) {
      setMsg({ ok: false, text: errorText(e) })
    }
    setBusy('')
  }

  async function logout() {
    const { signOut } = await import('../lib/drive')
    signOut()
    update({ googleAccount: '' })
    setMsg({ ok: true, text: t.sync.signedOut })
  }

  async function exportFile() {
    setMsg(null)
    setBusy(t.sync.exporting)
    try {
      const { exportBackup } = await import('../lib/sync')
      download(t.sync.file(dayKey(Date.now())), await exportBackup(db, withCovers))
    } catch (e) {
      setMsg({ ok: false, text: errorText(e) })
    }
    setBusy('')
  }

  async function importFile(file: File | undefined) {
    if (!file) return
    setMsg(null)
    setBusy(t.sync.syncing)
    try {
      const { importBackup } = await import('../lib/sync')
      setMsg({ ok: true, text: t.sync.imported(await importBackup(db, file)) })
    } catch {
      setMsg({ ok: false, text: t.sync.badFile })
    }
    setBusy('')
  }

  return (
    <section className="form card" id="sync">
      <h2>{t.sync.title}</h2>
      <p className="muted">{t.sync.lead}</p>

      <h3>{t.sync.driveTitle}</h3>
      {s.googleAccount ? (
        <>
          <p className="account">
            <span className="account-dot" aria-hidden />
            {t.sync.signedInAs(s.googleAccount)}
          </p>
          <div className="actions">
            <button type="button" className="btn primary" disabled={Boolean(busy)} onClick={sync}>
              {t.sync.syncNow}
            </button>
            <button type="button" className="btn" disabled={Boolean(busy)} onClick={logout}>
              {t.sync.signOut}
            </button>
          </div>
          <p className="muted">{s.lastSyncAt ? t.sync.last(timeAgo(s.lastSyncAt)) : t.sync.never}</p>
        </>
      ) : (
        <div className="actions">
          <button type="button" className="btn primary" disabled={Boolean(busy)} onClick={sync}>
            {t.sync.signIn}
          </button>
          <span className="muted">{t.sync.signInHint}</span>
        </div>
      )}
      <p className="muted">{t.sync.privacy}</p>
      <details className="more" open={Boolean(s.googleClientId)}>
        <summary>{t.sync.advanced}</summary>
        <label>
          {t.sync.clientId}
          <input
            value={s.googleClientId}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            placeholder="…apps.googleusercontent.com"
            onChange={(e) => update({ googleClientId: e.target.value.trim() })}
          />
          <span className="muted">{t.sync.clientIdHint}</span>
        </label>
      </details>

      <h3>{t.sync.backupTitle}</h3>
      <p className="muted">{t.sync.backupLead}</p>
      <label className="check">
        <input type="checkbox" checked={withCovers} onChange={(e) => setWithCovers(e.target.checked)} />
        {t.sync.withCovers}
      </label>
      <input
        ref={picker}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          importFile(file)
        }}
      />
      <div className="actions">
        <button type="button" className="btn" disabled={Boolean(busy)} onClick={exportFile}>
          {t.sync.export}
        </button>
        <button type="button" className="btn" disabled={Boolean(busy)} onClick={() => picker.current?.click()}>
          {t.sync.import}
        </button>
      </div>
      <p className="muted">{t.sync.importHint}</p>

      {busy && (
        <p className="muted" role="status">
          {busy}
        </p>
      )}
      {msg && (
        <p className={msg.ok ? 'ok' : 'error'} role={msg.ok ? 'status' : 'alert'}>
          {msg.text}
        </p>
      )}
    </section>
  )
}
