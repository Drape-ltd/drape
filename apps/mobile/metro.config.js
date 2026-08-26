const { getSentryExpoConfig } = require('@sentry/react-native/metro')
const path = require('path')

const projectRoot = __dirname
const workspaceRoot = path.resolve(projectRoot, '../..')

const config = getSentryExpoConfig(projectRoot, {
  annotateReactComponents: false,
  includeWebReplay: false,
})

// Watch the monorepo root so Metro can resolve workspace packages
config.watchFolders = [workspaceRoot]

// Let Metro find packages installed at the workspace root
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
]

// Metro doesn't support the package.json "exports" field — resolve @drape/shared
// and @drape/drape-vision sub-paths directly to their TypeScript source files.
const sharedSrc = path.resolve(workspaceRoot, 'packages/shared/src')
const drapeVisionSrc = path.resolve(workspaceRoot, 'packages/drape-vision/src')
const drapeVisionSubpaths = {
  'angle-detector': 'angleDetector',
  calibration: 'calibration',
  'capture-worklet': 'captureWorklet',
  'ellipse-fitter': 'ellipseFitter',
  'measurement-calculator': 'measurementCalculator',
}
const webidlConversionsEntry = require.resolve('webidl-conversions', {
  paths: [projectRoot],
})
// Keep React as a true singleton in the native bundle. The workspace also
// contains the web app's newer React runtime; allowing Metro to resolve from a
// watched package's real pnpm path can mix that runtime with React Native's
// renderer and surface as a null hook dispatcher when Daily mounts WebRTC
// views.
const mobileReactEntries = {
  react: require.resolve('react', { paths: [projectRoot] }),
  'react/jsx-runtime': require.resolve('react/jsx-runtime', { paths: [projectRoot] }),
  'react/jsx-dev-runtime': require.resolve('react/jsx-dev-runtime', { paths: [projectRoot] }),
}
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName in mobileReactEntries) {
    return {
      filePath: mobileReactEntries[moduleName],
      type: 'sourceFile',
    }
  }
  // Expo's URL runtime imports this package through a nested pnpm symlink.
  // Resolve the declared mobile dependency explicitly so Metro does not lose it
  // while traversing the transitive package's real path.
  if (moduleName === 'webidl-conversions') {
    return {
      filePath: webidlConversionsEntry,
      type: 'sourceFile',
    }
  }
  if (moduleName.startsWith('@drape/shared/')) {
    const subpath = moduleName.replace('@drape/shared/', '')
    return {
      filePath: path.resolve(sharedSrc, `${subpath}.ts`),
      type: 'sourceFile',
    }
  }
  if (moduleName === '@drape/shared') {
    return {
      filePath: path.resolve(sharedSrc, 'index.ts'),
      type: 'sourceFile',
    }
  }
  if (moduleName.startsWith('@drape/drape-vision/')) {
    const subpath = moduleName.replace('@drape/drape-vision/', '')
    const file = drapeVisionSubpaths[subpath] ?? subpath
    return {
      filePath: path.resolve(drapeVisionSrc, `${file}.ts`),
      type: 'sourceFile',
    }
  }
  if (moduleName === '@drape/drape-vision') {
    return {
      filePath: path.resolve(drapeVisionSrc, 'index.ts'),
      type: 'sourceFile',
    }
  }
  return context.resolveRequest(context, moduleName, platform)
}

module.exports = config
