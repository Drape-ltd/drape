import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // Drapeon brand palette
        'drape-green': '#2D6A4F',
        needle: {
          DEFAULT: '#2D6A4F',
          50: '#E8F5EF',
          100: '#C5E4D3',
          200: '#9FCFB5',
          300: '#79BA97',
          400: '#53A47A',
          500: '#2D6A4F',
          600: '#245540',
          700: '#1B4030',
          800: '#122B20',
          900: '#091611',
        },
        rust: {
          DEFAULT: '#D85A30',
          50: '#FAEEE9',
          100: '#F3CFC3',
          200: '#EAAF9D',
          300: '#E28F77',
          400: '#D96F51',
          500: '#D85A30',
          600: '#B04926',
          700: '#87371C',
          800: '#5E2613',
          900: '#351509',
        },
        bone: '#F5F0E8',
        ink: '#1A1A1A',
        ui: {
          canvas: '#F7F8F7',
          surface: '#FFFFFF',
          muted: '#F1F3F1',
          border: '#DDE2DE',
          subtle: '#667069',
        },
      },
      fontFamily: {
        sans: ['var(--font-body)', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}

export default config
