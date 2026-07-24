import { cp, lstat, realpath, rename, rm, unlink } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const mobileRoot = path.resolve(scriptDir, '..')

async function materializePackage(packageName) {
  const packagePath = path.join(mobileRoot, 'node_modules', packageName)
  const packageStat = await lstat(packagePath)

  if (!packageStat.isSymbolicLink()) {
    console.log(`[mobile native] ${packageName} already has a stable physical path.`)
    return
  }

  const sourcePath = await realpath(packagePath)
  if (!sourcePath.includes('patch_hash=')) {
    console.log(`[mobile native] ${packageName} does not need path materialization.`)
    return
  }

  const temporaryPath = `${packagePath}.materializing-${process.pid}`
  await rm(temporaryPath, { recursive: true, force: true })

  try {
    await cp(sourcePath, temporaryPath, { recursive: true })
    await unlink(packagePath)
    await rename(temporaryPath, packagePath)
    console.log(`[mobile native] Materialized ${packageName} for Android Prefab compatibility.`)
  } catch (error) {
    await rm(temporaryPath, { recursive: true, force: true })
    throw error
  }
}

await materializePackage('react-native-vision-camera')
