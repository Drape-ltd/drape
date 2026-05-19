const { getDefaultConfig } = require('expo/metro-config')
const path = require('path')

const projectRoot = __dirname
const workspaceRoot = path.resolve(projectRoot, '../..')

const config = getDefaultConfig(projectRoot)

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
config.resolver.resolveRequest = (context, moduleName, platform) => {
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
