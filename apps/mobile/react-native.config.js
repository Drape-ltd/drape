const path = require('path')

module.exports = {
  dependencies: {
    // The patched pnpm store path contains `patch_hash=`, which Android
    // Prefab parses as a command option. The repository materializer replaces
    // this app-level link with a physical package before native builds.
    'react-native-vision-camera': {
      root: path.resolve(__dirname, 'node_modules/react-native-vision-camera'),
    },
  },
}
