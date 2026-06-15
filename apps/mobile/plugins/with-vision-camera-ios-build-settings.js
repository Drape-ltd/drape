const { withPodfile } = require('expo/config-plugins')

function patchPodfile(contents) {
  if (contents.includes("target.name == 'VisionCamera'")) {
    return contents
  }

  const needle = "        config.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '15.1'\n"
  const patch = `${needle}
        if target.name == 'VisionCamera'
          # Xcode 26's Swift optimizer can crash while compiling VisionCamera.
          # Keep the workaround scoped to that pod so TestFlight builds stay stable.
          config.build_settings['SWIFT_COMPILATION_MODE'] = 'singlefile'
          config.build_settings['SWIFT_WHOLE_MODULE_OPTIMIZATION'] = 'NO'
          config.build_settings['SWIFT_OPTIMIZATION_LEVEL'] = '-Onone' if config.name == 'Release'
        end
`

  if (!contents.includes(needle)) {
    throw new Error('Could not patch VisionCamera iOS build settings: Podfile deployment target line not found.')
  }

  return contents.replace(needle, patch)
}

module.exports = function withVisionCameraIosBuildSettings(config) {
  return withPodfile(config, (modConfig) => {
    modConfig.modResults.contents = patchPodfile(modConfig.modResults.contents)
    return modConfig
  })
}
