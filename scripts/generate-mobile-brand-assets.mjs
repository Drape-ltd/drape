import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const assetsDir = join(root, 'apps/mobile/assets')

const GREEN = hex('#2D6A4F')
const GREEN_DARK = hex('#214D3B')
const BONE = hex('#F9F7F3')
const WHITE = hex('#FFFFFF')
const TRANSPARENT = { r: 0, g: 0, b: 0, a: 0 }

function hex(value) {
  const raw = value.replace('#', '')
  return {
    r: Number.parseInt(raw.slice(0, 2), 16),
    g: Number.parseInt(raw.slice(2, 4), 16),
    b: Number.parseInt(raw.slice(4, 6), 16),
    a: raw.length === 8 ? Number.parseInt(raw.slice(6, 8), 16) : 255,
  }
}

function makeImage(width, height, color) {
  const data = Buffer.alloc(width * height * 4)
  for (let index = 0; index < width * height; index += 1) {
    const offset = index * 4
    data[offset] = color.r
    data[offset + 1] = color.g
    data[offset + 2] = color.b
    data[offset + 3] = color.a
  }
  return { width, height, data }
}

function blendPixel(image, x, y, color, coverage = 1) {
  if (x < 0 || y < 0 || x >= image.width || y >= image.height || coverage <= 0) return
  const offset = (y * image.width + x) * 4
  const alpha = (color.a / 255) * Math.min(1, coverage)
  const inverse = 1 - alpha
  image.data[offset] = Math.round(color.r * alpha + image.data[offset] * inverse)
  image.data[offset + 1] = Math.round(color.g * alpha + image.data[offset + 1] * inverse)
  image.data[offset + 2] = Math.round(color.b * alpha + image.data[offset + 2] * inverse)
  image.data[offset + 3] = Math.round(255 * (alpha + (image.data[offset + 3] / 255) * inverse))
}

function drawShape(image, bounds, color, contains, samples = 4) {
  const left = Math.max(0, Math.floor(bounds.left))
  const top = Math.max(0, Math.floor(bounds.top))
  const right = Math.min(image.width, Math.ceil(bounds.right))
  const bottom = Math.min(image.height, Math.ceil(bounds.bottom))
  const total = samples * samples

  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      let hits = 0
      for (let sy = 0; sy < samples; sy += 1) {
        for (let sx = 0; sx < samples; sx += 1) {
          if (contains(x + (sx + 0.5) / samples, y + (sy + 0.5) / samples)) hits += 1
        }
      }
      if (hits > 0) blendPixel(image, x, y, color, hits / total)
    }
  }
}

function roundedRectContains(x, y, left, top, right, bottom, radius) {
  if (x < left || x > right || y < top || y > bottom) return false
  const cx = x < left + radius ? left + radius : x > right - radius ? right - radius : x
  const cy = y < top + radius ? top + radius : y > bottom - radius ? bottom - radius : y
  const dx = x - cx
  const dy = y - cy
  return dx * dx + dy * dy <= radius * radius
}

function drawRoundedRect(image, left, top, width, height, radius, color, samples = 4) {
  drawShape(
    image,
    { left, top, right: left + width, bottom: top + height },
    color,
    (x, y) => roundedRectContains(x, y, left, top, left + width, top + height, radius),
    samples,
  )
}

function drapeonDContains(x, y, left, top, size) {
  const u = ((x - left) / size) * 1024
  const v = ((y - top) / size) * 1024

  const bar = roundedRectContains(u, v, 304, 262, 438, 762, 34)
  const outer =
    u >= 386 &&
    ((u - 430) * (u - 430)) / (296 * 296) + ((v - 512) * (v - 512)) / (250 * 250) <= 1
  const inner =
    u >= 438 &&
    ((u - 438) * (u - 438)) / (152 * 152) + ((v - 512) * (v - 512)) / (132 * 132) <= 1

  return bar || (outer && !inner)
}

function drawD(image, left, top, size, color, samples = 4) {
  drawShape(
    image,
    { left: left + size * 0.25, top: top + size * 0.22, right: left + size * 0.78, bottom: top + size * 0.78 },
    color,
    (x, y) => drapeonDContains(x, y, left, top, size),
    samples,
  )
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type)
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const crcInput = Buffer.concat([typeBuffer, data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(crcInput), 0)
  return Buffer.concat([length, typeBuffer, data, crc])
}

function crc32(buffer) {
  let crc = 0xffffffff
  for (const byte of buffer) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

function encodePng(image) {
  const header = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(image.width, 0)
  ihdr.writeUInt32BE(image.height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  const scanlines = Buffer.alloc((image.width * 4 + 1) * image.height)
  for (let y = 0; y < image.height; y += 1) {
    const targetOffset = y * (image.width * 4 + 1)
    scanlines[targetOffset] = 0
    image.data.copy(scanlines, targetOffset + 1, y * image.width * 4, (y + 1) * image.width * 4)
  }

  return Buffer.concat([
    header,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(scanlines, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

function save(image, relativePath) {
  writeFileSync(join(assetsDir, relativePath), encodePng(image))
}

function makeIcon() {
  const image = makeImage(1024, 1024, GREEN)
  drawD(image, 0, 0, 1024, BONE, 5)
  return image
}

function makeAdaptiveIcon() {
  const image = makeImage(1024, 1024, TRANSPARENT)
  drawD(image, 0, 0, 1024, BONE, 5)
  return image
}

function makeNotificationIcon() {
  const image = makeImage(96, 96, TRANSPARENT)
  drawD(image, 0, 0, 96, WHITE, 5)
  return image
}

function makeSplash() {
  const image = makeImage(1284, 2778, BONE)
  const tileSize = 320
  const left = (image.width - tileSize) / 2
  const top = Math.round(image.height * 0.43)
  drawRoundedRect(image, left, top, tileSize, tileSize, 76, GREEN, 5)
  drawD(image, left, top, tileSize, BONE, 5)

  // A tiny grounding line keeps the splash from feeling like a placeholder while
  // staying quiet enough for App Store launch screens.
  drawRoundedRect(image, image.width / 2 - 26, top + tileSize + 58, 52, 4, 2, GREEN_DARK, 4)
  return image
}

save(makeIcon(), 'icon.png')
save(makeAdaptiveIcon(), 'adaptive-icon.png')
save(makeNotificationIcon(), 'notification-icon.png')
save(makeSplash(), 'splash.png')
save(makeIcon(), 'images/icon.png')

console.log('Generated Drapeon mobile brand assets.')
