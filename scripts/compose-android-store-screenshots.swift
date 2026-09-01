import AppKit
import Foundation

struct Slide {
  let file: String
  let eyebrow: String
  let headline: String
  let detail: String
  let source: String
  let background: NSColor
  let foreground: NSColor
  let accent: NSColor
  let imageTop: CGFloat
  let sourceTopCrop: CGFloat
}

let width = 1080
let height = 1920
let outputDirectory = URL(fileURLWithPath: CommandLine.arguments.dropFirst().first ?? "store-assets/android/phone")

let bone = NSColor(calibratedRed: 0.957, green: 0.941, blue: 0.910, alpha: 1)
let ink = NSColor(calibratedRed: 0.090, green: 0.102, blue: 0.094, alpha: 1)
let needle = NSColor(calibratedRed: 0.110, green: 0.353, blue: 0.259, alpha: 1)
let sage = NSColor(calibratedRed: 0.831, green: 0.890, blue: 0.851, alpha: 1)
let white = NSColor.white

let slides = [
  Slide(file: "01-explore-tailors.png", eyebrow: "TAILORING, MADE GLOBAL", headline: "Your tailor.\nAnywhere.", detail: "Explore independent tailors around the world.", source: "/private/tmp/drape-android-explore-clean.png", background: bone, foreground: ink, accent: needle, imageTop: 610, sourceTopCrop: 0),
  Slide(file: "02-tailor-profile.png", eyebrow: "APPROVED PROFILES", headline: "See the work.\nKnow the fit.", detail: "Portfolio, specialties, and availability in one place.", source: "/private/tmp/drape-android-alder-loaded.png", background: needle, foreground: white, accent: sage, imageTop: 610, sourceTopCrop: 0),
  Slide(file: "03-ready-made-piece.png", eyebrow: "READY WHEN YOU ARE", headline: "Find the piece.\nCheck every detail.", detail: "View photos, sizing, availability, and delivery options.", source: "/private/tmp/drape-ready-made-detail-fixed.png", background: bone, foreground: ink, accent: needle, imageTop: 610, sourceTopCrop: 0),
  Slide(file: "04-clear-quotes.png", eyebrow: "ONE CLEAR ORDER", headline: "Know the cost\nbefore the work.", detail: "Review the quote, timing, and protections together.", source: "/private/tmp/drape-project-overview-loaded.png", background: ink, foreground: white, accent: sage, imageTop: 610, sourceTopCrop: 0),
  Slide(file: "05-measurements.png", eyebrow: "FIT THAT STAYS WITH YOU", headline: "Measure once.\nRefine anytime.", detail: "Keep reusable fit details under your control.", source: "/private/tmp/drape-measurements.png", background: bone, foreground: ink, accent: needle, imageTop: 610, sourceTopCrop: 0),
  Slide(file: "06-notifications.png", eyebrow: "RETURN TO THE RIGHT DETAIL", headline: "See what changed.\nPick up in context.", detail: "Messages and quote updates lead back to the order.", source: "/private/tmp/drape-notifications-loaded.png", background: needle, foreground: white, accent: sage, imageTop: 610, sourceTopCrop: 0),
  Slide(file: "07-wishlists.png", eyebrow: "CONTINUE OR DISCOVER", headline: "Your next order\nstarts here.", detail: "Return to active work or discover another tailor.", source: "/private/tmp/drape-wishlist-browse.png", background: bone, foreground: ink, accent: needle, imageTop: 610, sourceTopCrop: 0),
]

func font(_ names: [String], size: CGFloat, weight: NSFont.Weight = .regular) -> NSFont {
  for name in names {
    if let value = NSFont(name: name, size: size) { return value }
  }
  return NSFont.systemFont(ofSize: size, weight: weight)
}

let serif = ["IowanOldStyle-Roman", "Georgia"]
let sans = ["AvenirNext-DemiBold", "HelveticaNeue-Medium"]
let body = ["AvenirNext-Regular", "HelveticaNeue"]

func drawText(_ value: String, rect: NSRect, font: NSFont, color: NSColor, spacing: CGFloat = 0, lineHeight: CGFloat? = nil) {
  let paragraph = NSMutableParagraphStyle()
  paragraph.lineBreakMode = .byWordWrapping
  if let lineHeight {
    paragraph.minimumLineHeight = lineHeight
    paragraph.maximumLineHeight = lineHeight
  }
  (value as NSString).draw(in: rect, withAttributes: [
    .font: font,
    .foregroundColor: color,
    .kern: spacing,
    .paragraphStyle: paragraph,
  ])
}

try FileManager.default.createDirectory(at: outputDirectory, withIntermediateDirectories: true)

for slide in slides {
  guard let screenshot = NSImage(contentsOfFile: slide.source) else {
    fputs("Missing source image: \(slide.source)\n", stderr)
    exit(2)
  }

  guard let bitmap = NSBitmapImageRep(
    bitmapDataPlanes: nil,
    pixelsWide: width,
    pixelsHigh: height,
    bitsPerSample: 8,
    samplesPerPixel: 4,
    hasAlpha: true,
    isPlanar: false,
    colorSpaceName: .deviceRGB,
    bytesPerRow: 0,
    bitsPerPixel: 0
  ) else { exit(3) }

  bitmap.size = NSSize(width: width, height: height)
  NSGraphicsContext.saveGraphicsState()
  NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)

  slide.background.setFill()
  NSRect(x: 0, y: 0, width: width, height: height).fill()

  drawText("DRAPEON", rect: NSRect(x: 72, y: 1810, width: 400, height: 38), font: font(sans, size: 25, weight: .semibold), color: slide.accent, spacing: 4)
  drawText(slide.eyebrow, rect: NSRect(x: 72, y: 1714, width: 900, height: 34), font: font(sans, size: 22, weight: .semibold), color: slide.accent, spacing: 4)
  drawText(slide.headline, rect: NSRect(x: 72, y: 1422, width: 930, height: 270), font: font(serif, size: 96), color: slide.foreground, lineHeight: 98)
  drawText(slide.detail, rect: NSRect(x: 76, y: 1324, width: 900, height: 72), font: font(body, size: 31), color: slide.foreground.withAlphaComponent(0.78), lineHeight: 42)

  let frame = NSRect(x: 92, y: 20, width: 896, height: CGFloat(height) - slide.imageTop)
  NSGraphicsContext.saveGraphicsState()
  let shadow = NSShadow()
  shadow.shadowColor = NSColor.black.withAlphaComponent(0.20)
  shadow.shadowBlurRadius = 28
  shadow.shadowOffset = NSSize(width: 0, height: -10)
  shadow.set()
  slide.foreground.withAlphaComponent(0.16).setFill()
  NSBezierPath(roundedRect: frame, xRadius: 46, yRadius: 46).fill()
  NSGraphicsContext.restoreGraphicsState()

  NSGraphicsContext.saveGraphicsState()
  NSBezierPath(roundedRect: frame, xRadius: 46, yRadius: 46).addClip()
  let scale = frame.width / screenshot.size.width
  let drawnHeight = screenshot.size.height * scale
  let sourceOffset = slide.sourceTopCrop * scale
  screenshot.draw(in: NSRect(x: frame.minX, y: frame.maxY - drawnHeight + sourceOffset, width: frame.width, height: drawnHeight), from: .zero, operation: .sourceOver, fraction: 1)
  NSGraphicsContext.restoreGraphicsState()

  NSGraphicsContext.restoreGraphicsState()
  guard let png = bitmap.representation(using: .png, properties: [:]) else { exit(4) }
  try png.write(to: outputDirectory.appendingPathComponent(slide.file))
  print("Wrote \(slide.file)")
}
