'use client'

import { Download, LoaderCircle, TriangleAlert } from 'lucide-react'
import { useState } from 'react'

export function OpsExportDownloadButton({ exportRequestId, reference }: {
  exportRequestId: string
  reference: string
}) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function download() {
    if (pending) return
    setPending(true)
    setError(null)
    try {
      const response = await fetch(`/ops/api/exports/${encodeURIComponent(exportRequestId)}/download`, {
        method: 'POST',
        headers: { 'x-correlation-id': crypto.randomUUID() },
      })
      if (!response.ok) {
        const payload = await response.json().catch(() => ({})) as Record<string, unknown>
        setError(String(payload.error ?? 'The protected download is unavailable.'))
        return
      }
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `${reference}.csv`
      anchor.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000)
    } finally {
      setPending(false)
    }
  }

  return <div className="ops-export-download">{error ? <small role="alert"><TriangleAlert size={12} />{error}</small> : null}<button className="ops-button" type="button" disabled={pending} onClick={download}>{pending ? <LoaderCircle className="ops-spin" size={14} /> : <Download size={14} />}Download</button></div>
}
