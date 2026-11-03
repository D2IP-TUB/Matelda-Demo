import { QRCodeSVG } from 'qrcode.react'

/** A scannable join link plus the link as text. */
export function JoinQr({ url }: { url: string }) {
  return (
    <div className="join-qr">
      <QRCodeSVG value={url} size={160} />
      <code>{url}</code>
    </div>
  )
}
