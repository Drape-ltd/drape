export type FormErrors<Field extends string = string> = Partial<Record<Field, string>>

export function normalizeSingleLineInput(value: string) {
  return value.replace(/\s+/gu, ' ').trim()
}

export function normalizeMultilineInput(value: string) {
  return value
    .replace(/\r\n?/gu, '\n')
    .split('\n')
    .map((line) => line.replace(/[^\S\n]+/gu, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim()
}

export function normalizeEmailInput(value: string) {
  return value.trim().toLocaleLowerCase()
}

export function clearFieldError<Field extends string>(
  errors: FormErrors<Field>,
  field: Field,
): FormErrors<Field> {
  if (!errors[field]) return errors
  const next = { ...errors }
  delete next[field]
  return next
}

export function firstInvalidField<Field extends string>(
  order: readonly Field[],
  errors: FormErrors<Field>,
) {
  return order.find((field) => Boolean(errors[field])) ?? null
}
