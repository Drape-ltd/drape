require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

Pod::Spec.new do |s|
  s.name         = "DrapeVision"
  s.version      = package["version"]
  s.summary      = "Native Drape Vision pose landmarker for VisionCamera frames."
  s.homepage     = "https://drape.app"
  s.license      = "UNLICENSED"
  s.authors      = "Drape"

  s.platforms    = { :ios => "15.1" }
  s.source       = { :path => "." }

  s.source_files = [
    "ios/**/*.{swift,m,mm}",
  ]
  s.resources = [
    "models/*.task",
  ]
  s.frameworks = ["AVFoundation", "CoreMedia", "UIKit"]

  load "nitrogen/generated/ios/DrapeVision+autolinking.rb"
  add_nitrogen_files(s)

  s.dependency "VisionCamera"
  s.dependency "MediaPipeTasksVision"
  s.dependency "React-jsi"
  s.dependency "React-callinvoker"
  install_modules_dependencies(s)
end
