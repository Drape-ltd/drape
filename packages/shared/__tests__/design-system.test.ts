import { darkColors } from '../src/design-system'

function relativeLuminance(hex: string) {
  const channels = hex
    .slice(1)
    .match(/.{2}/g)
    ?.map((channel) => Number.parseInt(channel, 16) / 255)
    .map((channel) =>
      channel <= 0.04045
        ? channel / 12.92
        : ((channel + 0.055) / 1.055) ** 2.4,
    )

  if (!channels || channels.length !== 3) {
    throw new Error(`Expected a six-digit hex color, received ${hex}`)
  }

  return (0.2126 * channels[0]) + (0.7152 * channels[1]) + (0.0722 * channels[2])
}

function contrastRatio(foreground: string, background: string) {
  const foregroundLuminance = relativeLuminance(foreground)
  const backgroundLuminance = relativeLuminance(background)
  const lightest = Math.max(foregroundLuminance, backgroundLuminance)
  const darkest = Math.min(foregroundLuminance, backgroundLuminance)

  return (lightest + 0.05) / (darkest + 0.05)
}

describe('Drape dark design system', () => {
  it('keeps normal and muted text readable on core surfaces', () => {
    expect(contrastRatio(darkColors.textSecondary, darkColors.background)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(darkColors.textSecondary, darkColors.surface)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(darkColors.textMuted, darkColors.background)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(darkColors.textMuted, darkColors.surface)).toBeGreaterThanOrEqual(4.5)
  })

  it('keeps borders visibly distinct from the dark canvas', () => {
    expect(contrastRatio(darkColors.border, darkColors.background)).toBeGreaterThanOrEqual(2)
  })

  it('keeps the adaptive brand foreground readable on dark surfaces', () => {
    expect(contrastRatio(darkColors.primaryDark, darkColors.primaryLight)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(darkColors.primaryDark, darkColors.surface)).toBeGreaterThanOrEqual(4.5)
  })
})
