type EmailDetail = {
  label: string
  value: string
}

type TransactionalEmailInput = {
  preheader: string
  eyebrow?: string
  headline: string
  recipientName: string
  body: string
  details?: EmailDetail[]
  ctaLabel: string
  ctaUrl: string
  secondaryCtaLabel?: string
  secondaryCtaUrl?: string
  evidenceImageUrl?: string | null
  evidenceImageAlt?: string
  evidenceLinkUrl?: string
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function paragraphHtml(value: string) {
  return escapeHtml(value).replaceAll('\n', '<br />')
}

export function normalizeDrapeonSender(
  rawSender: string | null | undefined,
  displayName = 'Drapeon',
  fallbackEmail = 'noreply@drapeon.co'
) {
  const safeDisplayName = displayName.trim() || 'Drapeon'
  const safeFallbackEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(fallbackEmail.trim())
    ? fallbackEmail.trim()
    : 'noreply@drapeon.co'
  const sender = rawSender?.trim()
  if (!sender) return `${safeDisplayName} <${safeFallbackEmail}>`

  const bracketedEmail = sender.match(/<([^<>]+@[^<>]+)>/u)?.[1]?.trim()
  if (bracketedEmail) return `${safeDisplayName} <${bracketedEmail}>`

  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(sender)) {
    return `${safeDisplayName} <${sender}>`
  }

  return `${safeDisplayName} <${safeFallbackEmail}>`
}

export function renderDrapeonTransactionalEmail(input: TransactionalEmailInput) {
  const details = input.details ?? []
  const detailRows = details
    .map(
      (detail, index) => `
    <tr>
      <td style="padding:${
        index === 0 ? '0' : '14px'
      } 0 0;color:#6b716d;font-family:Arial,sans-serif;font-size:14px;line-height:20px;vertical-align:top;width:38%">${escapeHtml(
        detail.label
      )}</td>
      <td style="padding:${
        index === 0 ? '0' : '14px'
      } 0 0 18px;color:#17211c;font-family:Arial,sans-serif;font-size:15px;font-weight:700;line-height:21px;text-align:right;vertical-align:top">${escapeHtml(
        detail.value
      )}</td>
    </tr>`
    )
    .join('')
  const detailsBlock = detailRows
    ? `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f3ee;border:1px solid #e7e3da;border-radius:12px;margin:26px 0">
        <tr>
          <td style="padding:20px 22px">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
              ${detailRows}
            </table>
          </td>
        </tr>
      </table>`
    : ''
  const evidenceImageUrl = input.evidenceImageUrl?.trim()
  const evidenceBlock =
    evidenceImageUrl && /^https?:\/\//u.test(evidenceImageUrl)
      ? `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0 0">
        <tr>
          <td>
            <a href="${escapeHtml(input.evidenceLinkUrl ?? input.ctaUrl)}" style="color:#2f7557;text-decoration:none">
              <img
                src="${escapeHtml(evidenceImageUrl)}"
                alt="${escapeHtml(input.evidenceImageAlt ?? 'Order update media')}"
                width="552"
                style="background:#f5f3ee;border:1px solid #e7e3da;border-radius:12px;display:block;height:auto;max-height:360px;max-width:100%;object-fit:contain;width:100%"
              />
              <span style="display:block;font-family:Arial,sans-serif;font-size:13px;font-weight:700;line-height:20px;padding-top:9px">View this media securely on Drapeon</span>
            </a>
          </td>
        </tr>
      </table>`
      : ''
  const eyebrow = input.eyebrow?.trim()
    ? `<p style="color:#2f7557;font-family:Arial,sans-serif;font-size:12px;font-weight:700;letter-spacing:1.4px;line-height:18px;margin:0 0 12px;text-transform:uppercase">${escapeHtml(
        input.eyebrow.trim()
      )}</p>`
    : ''
  const secondaryCta =
    input.secondaryCtaLabel?.trim() && input.secondaryCtaUrl?.trim()
      ? `
                <p style="font-family:Arial,sans-serif;font-size:14px;line-height:22px;margin:16px 0 0">
                  <a href="${escapeHtml(input.secondaryCtaUrl)}" style="color:#2f7557;font-weight:700;text-decoration:underline">${escapeHtml(input.secondaryCtaLabel)}</a>
                </p>`
      : ''

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <meta name="x-apple-disable-message-reformatting" />
    <title>${escapeHtml(input.headline)}</title>
  </head>
  <body style="background:#f4f1eb;margin:0;padding:0">
    <div style="display:none;font-size:1px;color:#f4f1eb;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden">${escapeHtml(
      input.preheader
    )}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f1eb;width:100%">
      <tr>
        <td align="center" style="padding:28px 14px">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%">
            <tr>
              <td style="padding:0 8px 20px">
                <span style="color:#225d45;font-family:Georgia,'Times New Roman',serif;font-size:30px;font-weight:700;line-height:36px">Drapeon</span>
              </td>
            </tr>
            <tr>
              <td style="background:#ffffff;border:1px solid #e5e1d8;border-radius:16px;padding:36px 32px">
                ${eyebrow}
                <h1 style="color:#17211c;font-family:Georgia,'Times New Roman',serif;font-size:34px;line-height:40px;margin:0 0 24px">${escapeHtml(
                  input.headline
                )}</h1>
                <p style="color:#25322b;font-family:Arial,sans-serif;font-size:16px;line-height:25px;margin:0 0 16px">Hi ${escapeHtml(
                  input.recipientName
                )},</p>
                <p style="color:#3d4942;font-family:Arial,sans-serif;font-size:16px;line-height:26px;margin:0">${paragraphHtml(
                  input.body
                )}</p>
                ${evidenceBlock}
                ${detailsBlock}
                <table role="presentation" cellpadding="0" cellspacing="0" style="margin:28px 0 4px">
                  <tr>
                    <td bgcolor="#2f7557" style="border-radius:999px">
                      <a href="${escapeHtml(
                        input.ctaUrl
                      )}" style="color:#ffffff;display:inline-block;font-family:Arial,sans-serif;font-size:16px;font-weight:700;line-height:20px;padding:15px 24px;text-decoration:none">${escapeHtml(
                        input.ctaLabel
                      )}</a>
                    </td>
                  </tr>
                </table>
                ${secondaryCta}
              </td>
            </tr>
            <tr>
              <td style="color:#6b716d;font-family:Arial,sans-serif;font-size:12px;line-height:19px;padding:20px 8px 0">
                This update was sent because you have activity on Drapeon.
                Need help? <a href="mailto:support@drapeon.co" style="color:#2f7557;text-decoration:underline">support@drapeon.co</a>
              </td>
            </tr>
            <tr>
              <td style="color:#8a8f8b;font-family:Arial,sans-serif;font-size:11px;line-height:18px;padding:8px 8px 0">
                Drapeon keeps order decisions, payments, and progress together.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`

  const textDetails =
    details.length > 0
      ? `\n\n${details.map((detail) => `${detail.label}: ${detail.value}`).join('\n')}`
      : ''
  const text = [
    input.headline,
    '',
    `Hi ${input.recipientName},`,
    '',
    input.body,
    textDetails,
    '',
    `${input.ctaLabel}: ${input.ctaUrl}`,
    ...(input.secondaryCtaLabel?.trim() && input.secondaryCtaUrl?.trim()
      ? [`${input.secondaryCtaLabel}: ${input.secondaryCtaUrl}`]
      : []),
    '',
    'Need help? support@drapeon.co',
  ].join('\n')

  return { html, text }
}
