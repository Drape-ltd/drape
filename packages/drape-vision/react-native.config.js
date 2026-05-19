module.exports = {
  dependency: {
    platforms: {
      android: {
        sourceDir: './android',
        packageImportPath: 'import com.margelo.nitro.drape.vision.DrapeVisionPackage;',
        packageInstance: 'new DrapeVisionPackage()',
      },
    },
  },
}
