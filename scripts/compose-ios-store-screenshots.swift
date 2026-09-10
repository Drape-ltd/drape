import AppKit
import Foundation

struct Slide {
  let file: String
  let index: String
  let eyebrow: String
  let headline: String
  let detail: String
  let source: String
  let background: NSColor
  let foreground: NSColor
  let accent: NSColor
  let screenTop: CGFloat
  let cropTop: CGFloat
}

let width = 1242
let height = 2688
let outputDirectory = URL(fileURLWithPath: CommandLine.arguments.dropFirst().first ?? "docs/store-assets/ios/editorial/phone")

let bone = NSColor(calibratedRed: 0.968, green: 0.953, blue: 0.925, alpha: 1)
let paper = NSColor(calibratedRed: 0.992, green: 0.984, blue: 0.967, alpha: 1)
let ink = NSColor(calibratedRed: 0.075, green: 0.090, blue: 0.082, alpha: 1)
let needle = NSColor(calibratedRed: 0.105, green: 0.355, blue: 0.258, alpha: 1)
let sage = NSColor(calibratedRed: 0.820, green: 0.895, blue: 0.850, alpha: 1)
let chalk = NSColor(calibratedWhite: 0.98, alpha: 1)

let raw = "docs/store-assets/ios/raw"
let slides = [
  Slide(file: "01-explore-tailors.png", index: "01", eyebrow: "TAILORING, MADE GLOBAL", headline: "Your tailor.\nAnywhere.", detail: "Explore independent tailors and active work in one place.", source: "\(raw)/00-current-physical.png", background: bone, foreground: ink, accent: needle, screenTop: 560, cropTop: 150),
  Slide(file: "02-verified-profile.png", index: "02", eyebrow: "APPROVED PROFILES", headline: "See the work.\nKnow the fit.", detail: "Review portfolios, specialties, and availability before you begin.", source: "\(raw)/04-tailor-profile.png", background: needle, foreground: chalk, accent: sage, screenTop: 560, cropTop: 150),
  Slide(file: "03-drapeon-vision.png", index: "03", eyebrow: "DRAPEON VISION", headline: "A fit profile\nmade around you.", detail: "Start with Fit 360, then refine the details your garment needs.", source: "\(raw)/02-vision-entry.png", background: ink, foreground: chalk, accent: sage, screenTop: 560, cropTop: 150),
  Slide(file: "04-saved-measurements.png", index: "04", eyebrow: "YOUR FIT, SAVED", headline: "Measure once.\nRefine anytime.", detail: "Keep reusable measurements together and under your control.", source: "\(raw)/03-measurements.png", background: paper, foreground: ink, accent: needle, screenTop: 560, cropTop: 150),
  Slide(file: "05-protected-quote.png", index: "05", eyebrow: "ONE CLEAR QUOTE", headline: "Know the cost.\nSee the protection.", detail: "Review construction, fabric allowance, tax, and timing together.", source: "\(raw)/05-tailor-profile-selected.png", background: needle, foreground: chalk, accent: sage, screenTop: 560, cropTop: 150),
  Slide(file: "06-order-conversation.png", index: "06", eyebrow: "CONTEXT THAT STAYS", headline: "Every decision,\nwith the order.", detail: "Keep design direction, questions, and approvals in one thread.", source: "\(raw)/06-order-conversation.png", background: bone, foreground: ink, accent: needle, screenTop: 560, cropTop: 150),
  Slide(file: "07-coordination-call.png", index: "07", eyebrow: "CLARITY WHEN NEEDED", headline: "Talk it through.\nKeep it connected.", detail: "Schedule a protected coordination call without losing context.", source: "\(raw)/07-selected-order-screen.png", background: ink, foreground: chalk, accent: sage, screenTop: 560, cropTop: 150),
  Slide(file: "08-active-order.png", index: "08", eyebrow: "YOUR WORK, IN VIEW", headline: "Know what is\nwaiting for you.", detail: "Return to the right order, status, price, and next action.", source: "\(raw)/08-order-screen-selected.png", background: paper, foreground: ink, accent: needle, screenTop: 560, cropTop: 150),
]

func font(_ names: [String], size: CGFloat, weight: NSFont.Weight = .regular) -> NSFont {
  for name in names {
    if let value = NSFont(name: name, size: size) { return value }
  }
  return NSFont.systemFont(ofSize: size, weight: weight)
}

let serif = ["IowanOldStyle-Roman", "NewYork-Regular", "Georgia"]
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

  // Quiet tailoring geometry: pattern curves and a single "thread" line.
  slide.accent.withAlphaComponent(0.14).setStroke()
  let curve = NSBezierPath()
  curve.lineWidth = 2
  curve.move(to: NSPoint(x: 910, y: 2675))
  curve.curve(to: NSPoint(x: 1225, y: 2300), controlPoint1: NSPoint(x: 1110, y: 2600), controlPoint2: NSPoint(x: 1040, y: 2370))
  curve.stroke()
  NSBezierPath(ovalIn: NSRect(x: 1050, y: 2380, width: 330, height: 330)).stroke()

  drawText("DRAPEON", rect: NSRect(x: 84, y: 2570, width: 430, height: 38), font: font(sans, size: 27, weight: .semibold), color: slide.accent, spacing: 5)
  drawText(slide.index, rect: NSRect(x: 1070, y: 2560, width: 90, height: 55), font: font(sans, size: 30, weight: .semibold), color: slide.accent, spacing: 3)
  drawText(slide.eyebrow, rect: NSRect(x: 84, y: 2470, width: 970, height: 40), font: font(sans, size: 23, weight: .semibold), color: slide.accent, spacing: 5)
  drawText(slide.headline, rect: NSRect(x: 82, y: 2190, width: 1060, height: 265), font: font(serif, size: 102), color: slide.foreground, lineHeight: 100)
  drawText(slide.detail, rect: NSRect(x: 88, y: 2070, width: 1010, height: 82), font: font(body, size: 33), color: slide.foreground.withAlphaComponent(0.76), lineHeight: 44)

  let frame = NSRect(x: 120, y: -70, width: 1002, height: CGFloat(height) - slide.screenTop)
  NSGraphicsContext.saveGraphicsState()
  let shadow = NSShadow()
  shadow.shadowColor = NSColor.black.withAlphaComponent(0.24)
  shadow.shadowBlurRadius = 42
  shadow.shadowOffset = NSSize(width: 0, height: -16)
  shadow.set()
  slide.foreground.withAlphaComponent(0.14).setFill()
  NSBezierPath(roundedRect: frame, xRadius: 62, yRadius: 62).fill()
  NSGraphicsContext.restoreGraphicsState()

  NSGraphicsContext.saveGraphicsState()
  NSBezierPath(roundedRect: frame, xRadius: 62, yRadius: 62).addClip()
  let sourceRect = NSRect(x: 0, y: 0, width: screenshot.size.width, height: screenshot.size.height - slide.cropTop)
  let scale = frame.width / sourceRect.width
  let drawnHeight = sourceRect.height * scale
  screenshot.draw(
    in: NSRect(x: frame.minX, y: frame.maxY - drawnHeight, width: frame.width, height: drawnHeight),
    from: sourceRect,
    operation: .sourceOver,
    fraction: 1
  )
  NSGraphicsContext.restoreGraphicsState()

  NSGraphicsContext.restoreGraphicsState()
  guard let png = bitmap.representation(using: .png, properties: [:]) else { exit(4) }
  try png.write(to: outputDirectory.appendingPathComponent(slide.file))
  print("Wrote \(slide.file)")
}
