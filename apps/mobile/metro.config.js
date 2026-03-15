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
// sub-paths directly to their TypeScript source files.
const sharedSrc = path.resolve(workspaceRoot, 'packages/shared/src')
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
  return context.resolveRequest(context, moduleName, platform)
}

module.exports = config
