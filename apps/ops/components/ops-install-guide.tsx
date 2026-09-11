'use client'

import { BellRing, Check, Copy, Download, ExternalLink, LockKeyhole, Share2, Smartphone } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { useEffect, useMemo, useState } from 'react'

type InstallPrompt = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const INSTALL_URL = 'https://ops.drapeon.co/install'

function platformFromUserAgent(userAgent: string) {
  if (/iPad|iPhone|iPod/.test(userAgent)) return 'ios'
  if (/Android/.test(userAgent)) return 'android'
  return 'desktop'
}

export function OpsInstallGuide({ compact = false }: { compact?: boolean }) {
  const [installPrompt, setInstallPrompt] = useState<InstallPrompt | null>(null)
  const [installed, setInstalled] = useState(() => typeof window !== 'undefined' && window.matchMedia('(display-mode: standalone)').matches)
  const [copied, setCopied] = useState(false)
  const [platform] = useState<'ios' | 'android' | 'desktop'>(() => typeof navigator === 'undefined' ? 'desktop' : platformFromUserAgent(navigator.userAgent))

  useEffect(() => {
    if ('serviceWorker' in navigator) void navigator.serviceWorker.register('/ops-sw.js', { scope: '/' })

    const beforeInstall = (event: Event) => {
      event.preventDefault()
      setInstallPrompt(event as InstallPrompt)
    }
    const onInstalled = () => {
      setInstalled(true)
      setInstallPrompt(null)
    }
    window.addEventListener('beforeinstallprompt', beforeInstall)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', beforeInstall)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  const instructions = useMemo(() => {
    if (platform === 'ios') return [
      { title: 'Open in Safari', detail: 'If this page opened inside another app, use its menu to open Safari.' },
      { title: 'Tap Share', detail: 'Use the Share button in Safari’s toolbar.' },
      { title: 'Add to Home Screen', detail: 'Confirm Add. Drapeon Ops will appear with your other apps.' },
      { title: 'Turn on urgent alerts', detail: 'Launch from the new icon, sign in, then enable alerts from the Ops header.' },
    ]
    if (platform === 'android') return [
      { title: 'Open in Chrome', detail: 'Use Chrome if the QR opened inside another app.' },
      { title: 'Install Drapeon Ops', detail: 'Tap the install action below or Chrome’s Install app menu item.' },
      { title: 'Launch securely', detail: 'Open the new icon and complete Drapeon workforce authentication.' },
      { title: 'Turn on urgent alerts', detail: 'Enable alerts from the Ops header after your staff identity is confirmed.' },
    ]
    return [
      { title: 'Scan with the staff phone', detail: 'The QR opens this secure installer on iPhone or Android.' },
      { title: 'Install from the browser', detail: 'Use the install prompt or Add to Home Screen guidance.' },
      { title: 'Authenticate on launch', detail: 'Cloudflare Access and the named workforce role are still required.' },
      { title: 'Enable urgent alerts', detail: 'After sign-in, explicitly enable privacy-safe case notifications.' },
    ]
  }, [platform])

  const copyLink = async () => {
    await navigator.clipboard.writeText(INSTALL_URL)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1800)
  }

  const requestInstall = async () => {
    if (!installPrompt) return
    await installPrompt.prompt()
    const choice = await installPrompt.userChoice
    if (choice.outcome === 'accepted') setInstalled(true)
    setInstallPrompt(null)
  }

  return (
    <section className={compact ? 'ops-install-card ops-install-card-compact' : 'ops-install-card'}>
      <div className="ops-install-copy">
        <p className="ops-action-label">Staff mobile access</p>
        <h2>{installed ? 'Drapeon Ops is installed.' : 'Scan once. Install securely.'}</h2>
        <p>
          The QR carries only the public installer address. It contains no password, session, staff identity, or access bypass.
        </p>
        <div className="ops-install-security"><LockKeyhole size={15} /><span>Every launch remains protected by Cloudflare Access and database-authorized staff roles.</span></div>
        <div className="ops-inline-actions">
          {installPrompt && !installed ? <button className="ops-button ops-button-primary" type="button" onClick={requestInstall}><Download size={15} />Install Drapeon Ops</button> : null}
          {installed ? <span className="ops-command-confirmed"><Check size={15} />Installed on this device</span> : null}
          <button className="ops-button" type="button" onClick={copyLink}>{copied ? <Check size={15} /> : <Copy size={15} />}{copied ? 'Copied' : 'Copy install link'}</button>
          <a className="ops-button" href={INSTALL_URL} target="_blank" rel="noreferrer"><ExternalLink size={15} />Open installer</a>
        </div>
      </div>
      <div className="ops-install-qr" aria-label="QR code for the Drapeon Ops secure installer">
        <QRCodeSVG value={INSTALL_URL} size={compact ? 164 : 208} level="Q" marginSize={2} bgColor="#ffffff" fgColor="#11251b" title="Drapeon Ops secure installer" />
          <span>ops.drapeon.co/install</span>
      </div>
      {!compact ? <ol className="ops-install-steps">
        {instructions.map((instruction, index) => <li key={instruction.title}>
          <span>{String(index + 1).padStart(2, '0')}</span>
          <div><strong>{instruction.title}</strong><small>{instruction.detail}</small></div>
          {index === 1 ? <Share2 size={16} /> : index === instructions.length - 1 ? <BellRing size={16} /> : <Smartphone size={16} />}
        </li>)}
      </ol> : null}
    </section>
  )
}
