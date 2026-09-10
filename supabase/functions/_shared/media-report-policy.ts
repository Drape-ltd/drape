export type MediaReportReason = 'NUDITY_OR_SEXUAL' | 'VIOLENCE_OR_HATE' | 'CHILD_SAFETY' | 'SCAM_OR_IMPERSONATION' | 'OTHER'

export function deriveMediaReportModeration(reason: MediaReportReason, distinctOpenReports: number) {
  const automaticallyBlocked = reason === 'CHILD_SAFETY' || distinctOpenReports >= 2
  return {
    automaticallyBlocked,
    riskLevel: automaticallyBlocked ? 'HIGH' as const : 'MEDIUM' as const,
    status: automaticallyBlocked ? 'AUTO_BLOCKED' as const : null,
  }
}
