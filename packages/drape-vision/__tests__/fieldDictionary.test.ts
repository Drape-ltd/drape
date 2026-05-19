import {
  DRAPE_VISION_FIELD_DICTIONARY,
  DRAPE_VISION_LAYER_3_FIELDS,
} from '../src/fieldDictionary'

describe('Drape Vision field dictionary', () => {
  it('keeps bodice fields as explicit tailor-confirmed definitions', () => {
    expect(DRAPE_VISION_FIELD_DICTIONARY.highBust.defaultConfidenceStatus).toBe('MANUAL_ENTRY')
    expect(DRAPE_VISION_FIELD_DICTIONARY.bustPointSpacing.defaultConfidenceStatus).toBe('MANUAL_ENTRY')
    expect(DRAPE_VISION_FIELD_DICTIONARY.bustPointToWaist.defaultConfidenceStatus).toBe('MANUAL_ENTRY')
    expect(DRAPE_VISION_FIELD_DICTIONARY.armholeDepth.note).toContain('tailor confirmation')
  })

  it('keeps headwear and fila fields out of generic body-scan confidence', () => {
    expect(DRAPE_VISION_FIELD_DICTIONARY.headCircumference.defaultConfidenceStatus).toBe('MANUAL_ENTRY')
    expect(DRAPE_VISION_FIELD_DICTIONARY.hatBandLine.note).toContain('wearer likes')
    expect(DRAPE_VISION_FIELD_DICTIONARY.filaHeight.note).toContain('style measurement')
    expect(DRAPE_VISION_LAYER_3_FIELDS).toEqual(expect.arrayContaining([
      'headCircumference',
      'hatBandLine',
      'earToEarOverCrown',
      'frontToBackOverCrown',
      'filaHeight',
    ]))
  })
})
