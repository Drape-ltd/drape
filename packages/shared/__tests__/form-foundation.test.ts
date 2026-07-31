import {
  clearFieldError,
  firstInvalidField,
  normalizeEmailInput,
  normalizeMultilineInput,
  normalizeSingleLineInput,
} from '../src/form-foundation'

describe('shared form foundation', () => {
  it('normalizes pasted and autofilled single-line values', () => {
    expect(normalizeSingleLineInput('  Ada   Okafor \n')).toBe('Ada Okafor')
    expect(normalizeEmailInput('  ADA@EXAMPLE.COM ')).toBe('ada@example.com')
  })

  it('preserves intentional paragraphs while cleaning multiline input', () => {
    expect(normalizeMultilineInput(' First   line \r\n\r\n\r\n Second line ')).toBe(
      'First line\n\nSecond line',
    )
  })

  it('clears only the stale error for the field being edited', () => {
    expect(clearFieldError<'phone' | 'email'>({ phone: 'Invalid', email: 'Required' }, 'phone')).toEqual({
      email: 'Required',
    })
  })

  it('returns the first invalid field in visual order', () => {
    expect(firstInvalidField(['name', 'phone', 'email'], {
      email: 'Required',
      phone: 'Invalid',
    })).toBe('phone')
  })
})
