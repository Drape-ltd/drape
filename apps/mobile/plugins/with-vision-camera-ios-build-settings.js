const { withPodfile } = require('expo/config-plugins')

function patchPodfile(contents) {
  const hasVisionCameraPatch = contents.includes("target.name == 'VisionCamera'")
  const hasFmtPatch = contents.includes("target.name == 'fmt'")

  if (hasVisionCameraPatch && hasFmtPatch) {
    return contents
  }

  const additions = []

  if (!hasVisionCameraPatch) {
    additions.push(`
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
`)
  }

  if (!hasFmtPatch) {
    additions.push(`
    installer.pods_project.targets.each do |target|
      next unless target.name == 'fmt'

      target.build_configurations.each do |config|
        # Xcode 26.5 treats fmt's C++20 consteval format strings too strictly.
        # Keep this scoped to fmt so React Native's other C++ pods stay unchanged.
        config.build_settings['CLANG_CXX_LANGUAGE_STANDARD'] = 'gnu++17'
        definitions = config.build_settings['GCC_PREPROCESSOR_DEFINITIONS']
        definitions = ['$(inherited)'] if definitions.nil?
        definitions = [definitions] if definitions.is_a?(String)
        definitions << 'FMT_USE_CONSTEVAL=0'
        config.build_settings['GCC_PREPROCESSOR_DEFINITIONS'] = definitions.uniq
      end
    end
`)
  }

  const needle = "  post_install do |installer|\n"
  const patch = `${needle}${additions.join('')}`

  if (contents.includes(needle)) {
    return contents.replace(needle, patch)
  }

  const targetEnd = "\nend\n"
  const fallback = `
  post_install do |installer|${additions.join('')}
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
