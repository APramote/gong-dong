import { useEffect, useRef, useState } from 'react'
import { db } from '../db/db'
import { download } from '../lib/download'
import { loadSettings, saveSettings } from '../lib/settings'
import { dayKey, timeAgo } from '../lib/stats'
import { refresh, reset, syncNow, setAutoSync } from '../lib/autosync'
import { syncErrorText } from '../lib/syncError'
import { t } from '../th'
import { useAutoSync } from './SyncBanner'

type Msg = { ok: boolean; text: string } | null

/** ซิงก์กับ Google Drive และสำรอง/กู้คืนเป็นไฟล์ */
export function SyncCard() {
  const [s, setS] = useState(loadSettings)
  const auto = useAutoSync()
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState<Msg>(null)
  /** งานที่กำลังทำเป็นของส่วนไหน ข้อความจะแสดงใต้ปุ่มของส่วนนั้น */
  const [area, setArea] = useState<'drive' | 'backup'>('drive')
  // เปิดส่วน Client ID ไว้ถ้าผู้ใช้เคยใส่ค่าเอง (คิดครั้งเดียว ไม่พับเองระหว่างพิมพ์)
  const [advanced] = useState(() => Boolean(loadSettings().googleClientId))
  // โหลดโค้ดซิงก์ไว้ล่วงหน้า ตอนกดปุ่มจะได้เปิดหน้าต่างของ Google ทันที (ช้าไปเบราว์เซอร์จะบล็อก)
  useEffect(() => {
    // โหลดสคริปต์ของ Google ล่วงหน้าเฉพาะเมื่อเคยเข้าสู่ระบบแล้ว (ผู้ที่ไม่ใช้ Google ไม่ต้องติดต่อ Google เลย)
    void import('../lib/drive').then((m) => loadSettings().googleAccount && m.preload())
    void import('../lib/sync')
  }, [])
  const [withCovers, setWithCovers] = useState(true)
  const picker = useRef<HTMLInputElement>(null)
  const update = (patch: Partial<typeof s>) => {
    const next = { ...loadSettings(), ...patch }
    saveSettings(next)
    setS(next)
    refresh()
  }

  /** เข้าสู่ระบบ (ถ้ายังไม่เข้า) แล้วซิงก์ทันที */
  async function sync() {
    setArea('drive')
    setMsg(null)
    setBusy(auto.account ? t.sync.syncing : t.sync.signingIn)
    try {
      const r = await syncNow(true, (done, total) => setBusy(t.sync.covers(done, total)))
      update({}) // อ่านบัญชีและเวลาซิงก์ล่าสุดที่เพิ่งบันทึก
      if (r) setMsg({ ok: true, text: t.sync.done(r.pushed, r.pulled) })
    } catch (e) {
      setMsg({ ok: false, text: syncErrorText(e) })
    }
    setBusy('')
  }

  async function logout() {
    setArea('drive')
    const { signOut } = await import('../lib/drive')
    // หยุดการซิงก์ที่กำลังทำอยู่ก่อน ไม่ให้บันทึกบัญชีกลับมาหลังออกจากระบบ
    await reset()
    const revoked = signOut()
    update({ googleAccount: '' })
    setMsg({ ok: true, text: revoked ? t.sync.signedOut : t.sync.signedOutLocal })
  }

  async function exportFile() {
    setArea('backup')
    setMsg(null)
    setBusy(t.sync.exporting)
    try {
      const { exportBackup } = await import('../lib/sync')
      download(t.sync.file(dayKey(Date.now())), await exportBackup(db, withCovers))
    } catch (e) {
      setMsg({ ok: false, text: syncErrorText(e) })
    }
    setBusy('')
  }

  async function importFile(file: File | undefined) {
    if (!file) return
    setArea('backup')
    setMsg(null)
    setBusy(t.sync.importing)
    try {
      const { importBackup } = await import('../lib/sync')
      setMsg({ ok: true, text: t.sync.imported(await importBackup(db, file)) })
    } catch {
      setMsg({ ok: false, text: t.sync.badFile })
    }
    setBusy('')
  }

  /** ผลและความคืบหน้าของแต่ละส่วน อยู่ใต้ปุ่มที่กด (กล่องสถานะอยู่ในหน้าเสมอ โปรแกรมอ่านหน้าจอจึงประกาศได้) */
  const status = (where: 'drive' | 'backup') => (
    <div role="status" aria-live="polite">
      {area === where && busy && <p className="muted">{busy}</p>}
      {area === where && msg && <p className={msg.ok ? 'ok' : 'error'}>{msg.text}</p>}
    </div>
  )

  return (
    <section className="form card" id="sync">
      <h2>{t.sync.title}</h2>
      <p className="muted">{t.sync.lead}</p>

      <h3>{t.sync.driveTitle}</h3>
      {auto.account ? (
        <>
          <p className="account">
            <span className="account-dot" aria-hidden />
            {t.sync.signedInAs(auto.account)}
          </p>
          <div className="actions">
            <button type="button" className="btn primary" disabled={Boolean(busy)} onClick={sync}>
              {t.sync.syncNow}
            </button>
            <button type="button" className="btn" disabled={Boolean(busy)} onClick={logout}>
              {t.sync.signOut}
            </button>
          </div>
          <p className="muted">
            {auto.lastSyncAt ? t.sync.last(timeAgo(auto.lastSyncAt)) : t.sync.never}
            {auto.pending && ` · ${t.sync.pending}`}
          </p>
          <label className="switch-row">
            <input type="checkbox" role="switch" checked={auto.auto} onChange={(e) => setAutoSync(e.target.checked)} />
            <span>
              <span className="row-title">{t.sync.autoSwitch}</span>
              <span className="row-sub">
                {!auto.auto ? t.sync.autoOff : auto.error && auto.pending ? t.sync.autoRetry : t.sync.autoHint}
              </span>
            </span>
          </label>
        </>
      ) : (
        <div className="actions">
          {/* ยังไม่เคยเข้าสู่ระบบ: เริ่มโหลดสคริปต์ของ Google ตอนนิ้วแตะปุ่ม ทันเปิดหน้าต่างตอนปล่อยนิ้ว */}
          <button
            type="button"
            className="btn primary"
            disabled={Boolean(busy)}
            onPointerDown={() => void import('../lib/drive').then((m) => m.preload())}
            onFocus={() => void import('../lib/drive').then((m) => m.preload())}
            onClick={sync}
          >
            {t.sync.signIn}
          </button>
          <span className="muted">{t.sync.signInHint}</span>
        </div>
      )}
      <p className="muted">{t.sync.privacy}</p>
      {status('drive')}
      <details className="more" open={advanced || undefined}>
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

      {status('backup')}
    </section>
  )
}
