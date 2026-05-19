export type PreflightSeverity = 'BLOCKING' | 'WARNING'

export interface PreflightCheck {
  name: string
  condition: boolean
  errorCode: string
  message: string
  field?: string
  severity: PreflightSeverity
  actual?: unknown
}

export interface PreflightResult {
  passed: boolean
  failures: PreflightCheck[]
  warnings: PreflightCheck[]
}

export function runPreflight(checks: PreflightCheck[]): PreflightResult {
  const failures = checks.filter((check) => !check.condition && check.severity === 'BLOCKING')
  const warnings = checks.filter((check) => !check.condition && check.severity === 'WARNING')

  return {
    passed: failures.length === 0,
    failures,
    warnings,
  }
}

export function firstPreflightFailure(result: PreflightResult): PreflightCheck | null {
  return result.failures[0] ?? null
}

export function preflightErrorPayload(check: PreflightCheck, warnings: PreflightCheck[] = []) {
  return {
    error: 'PREFLIGHT_FAILED',
    reason: check.errorCode,
    message: check.message,
    field: check.field,
    check: check.name,
    warnings: warnings.map((warning) => ({
      reason: warning.errorCode,
      message: warning.message,
      field: warning.field,
      check: warning.name,
    })),
  }
}
