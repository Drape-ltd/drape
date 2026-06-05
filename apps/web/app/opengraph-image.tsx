import { ImageResponse } from 'next/og'

export const size = {
  width: 1200,
  height: 630,
}

export const contentType = 'image/png'

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          display: 'flex',
          width: '100%',
          height: '100%',
          background: 'linear-gradient(180deg, #f7f1e8 0%, #f3ede2 100%)',
          color: '#1A1A1A',
          padding: '72px',
          flexDirection: 'column',
          justifyContent: 'space-between',
          fontFamily: 'sans-serif',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            alignSelf: 'flex-start',
            border: '1px solid rgba(45,106,79,0.15)',
            borderRadius: '999px',
            padding: '14px 24px',
            background: 'rgba(255,255,255,0.85)',
            color: '#2D6A4F',
            fontSize: 24,
            fontWeight: 700,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
          }}
        >
          AI-powered fashion discovery and fit
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '28px', maxWidth: '900px' }}>
          <div style={{ fontSize: 112, lineHeight: 0.9, fontWeight: 700, letterSpacing: '-0.06em' }}>
            Drapeon
          </div>
          <div style={{ fontSize: 76, lineHeight: 1, fontWeight: 700, letterSpacing: '-0.05em' }}>
            Fashion that fits before the first stitch.
          </div>
          <div style={{ fontSize: 32, lineHeight: 1.4, color: 'rgba(26,26,26,0.72)' }}>
            Discover fashion, work with trusted tailors, and capture fit measurements with Drape Vision.
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            gap: '18px',
          }}
        >
          {['Discover', 'Measure', 'Order'].map((item) => (
            <div
              key={item}
              style={{
                display: 'flex',
                borderRadius: '999px',
                padding: '14px 22px',
                background: '#ffffff',
                fontSize: 24,
                fontWeight: 600,
                color: '#1A1A1A',
              }}
            >
              {item}
            </div>
          ))}
        </div>
      </div>
    ),
    size
  )
}
