import { QRCodeSVG } from 'qrcode.react'
import { useEffect, useState } from 'react'
import { useT } from '../i18n'

/** A scannable join link plus a button that copies the link. */
export function JoinQr({ url }: { url: string }) {
  const tr = useT().shell
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(t)
  }, [copied])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
    } catch {
      /* clipboard blocked: the QR code still works */
    }
  }

  return (
    <div className="join-qr">
      <QRCodeSVG value={url} size={160} />
      <button type="button" className="btn btn-ghost btn-sm join-copy" onClick={() => void copy()} aria-live="polite">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          {copied ? <path d="M5 12.5l4.5 4.5L19 7.5" /> : (<><rect x="9" y="9" width="11" height="11" rx="2.5" /><path d="M5 15V6.5A2.5 2.5 0 0 1 7.5 4H15" /></>)}
        </svg>
        {copied ? tr.linkCopied : tr.copyLink}
      </button>
    </div>
  )
}
