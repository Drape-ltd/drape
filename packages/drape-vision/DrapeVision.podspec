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

  # Nitro mutates source_files for generated bridges; keep handwritten Swift
  # implementations in the pod so EAS remote iOS builds can resolve them.
  s.source_files = (Array(s.attributes_hash["source_files"]) + [
    "ios/**/*.{swift,m,mm}",
  ]).uniq

  generated_header_search_paths = [
    "$(PODS_TARGET_SRCROOT)/nitrogen/generated/shared/c++",
    "$(PODS_TARGET_SRCROOT)/nitrogen/generated/ios",
    "$(PODS_TARGET_SRCROOT)/nitrogen/generated/ios/c++",
  ]
  current_pod_target_xcconfig = s.attributes_hash["pod_target_xcconfig"] || {}
  existing_header_search_paths = Array(current_pod_target_xcconfig["HEADER_SEARCH_PATHS"])
  s.pod_target_xcconfig = current_pod_target_xcconfig.merge({
    "HEADER_SEARCH_PATHS" => (existing_header_search_paths + generated_header_search_paths).join(" "),
  })

  s.dependency "VisionCamera"
  s.dependency "MediaPipeTasksVision"
  s.dependency "React-jsi"
  s.dependency "React-callinvoker"
  install_modules_dependencies(s)
end
