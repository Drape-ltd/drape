const { withPodfile } = require('expo/config-plugins')

function patchPodfile(contents) {
  if (contents.includes("target.name == 'VisionCamera'")) {
    return contents
  }

  const needle = "  post_install do |installer|\n"
  const patch = `${needle}
    installer.pods_project.targets.each do |target|
      next unless target.name == 'VisionCamera'

      target.build_configurations.each do |config|
        # Xcode 26's Swift optimizer can crash while compiling VisionCamera.
        # Keep the workaround scoped to that pod so TestFlight builds stay stable.
        config.build_settings['SWIFT_COMPILATION_MODE'] = 'singlefile'
        config.build_settings['SWIFT_WHOLE_MODULE_OPTIMIZATION'] = 'NO'
        config.build_settings['SWIFT_OPTIMIZATION_LEVEL'] = '-Onone' if config.name == 'Release'
      end
    end

`

  if (contents.includes(needle)) {
    return contents.replace(needle, patch)
  }

  const targetEnd = "\nend\n"
  const fallback = `
  post_install do |installer|
    installer.pods_project.targets.each do |target|
      next unless target.name == 'VisionCamera'

      target.build_configurations.each do |config|
        # Xcode 26's Swift optimizer can crash while compiling VisionCamera.
        # Keep the workaround scoped to that pod so TestFlight builds stay stable.
        config.build_settings['SWIFT_COMPILATION_MODE'] = 'singlefile'
        config.build_settings['SWIFT_WHOLE_MODULE_OPTIMIZATION'] = 'NO'
        config.build_settings['SWIFT_OPTIMIZATION_LEVEL'] = '-Onone' if config.name == 'Release'
      end
    end
  end
`

  if (contents.includes(targetEnd)) {
    return contents.replace(targetEnd, `${fallback}${targetEnd}`)
  }

  throw new Error('Could not patch VisionCamera iOS build settings: Podfile target block not found.')
}

module.exports = function withVisionCameraIosBuildSettings(config) {
  return withPodfile(config, (modConfig) => {
    modConfig.modResults.contents = patchPodfile(modConfig.modResults.contents)
    return modConfig
  })
}
