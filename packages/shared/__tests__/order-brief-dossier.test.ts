import { buildBriefDossier } from '../src/order-brief-dossier'

describe('order brief dossier display labels', () => {
  it('formats body profile enums before exposing dossier rows to clients', () => {
    const dossier = buildBriefDossier({
      measurementSnapshot: {
        garmentContext: 'BOTH',
        bodyShape: ['INVERTED_TRIANGLE', 'ShapeRectangle', 'DEFINED_WAIST'],
        fitFlags: ['LARGE_THIGHS', 'BROAD_SHOULDERS'],
        bodyFlags: ['SHORT_TORSO'],
        symmetryFlags: ['LEFT_SHOULDER_LOWER'],
      },
    })

    const measurements = dossier.sections.find((section) => section.id === 'measurements')
    const cutContext = measurements?.rows.find((row) => row.id === 'cut_context')
    const bodyShape = measurements?.rows.find((row) => row.id === 'body_shape')
    const bodyContext = measurements?.rows.find((row) => row.id === 'body_flags')

    expect(cutContext?.value).toBe('Both')
    expect(bodyShape?.value).toBe('Inverted Triangle, Shape Rectangle, Defined Waist')
    expect(bodyContext?.values).toEqual([
      'Large Thighs',
      'Broad Shoulders',
      'Short Torso',
      'Left Shoulder Lower',
    ])
  })
})
