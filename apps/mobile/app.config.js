const fs = require("fs");
const path = require("path");

const appJson = require("./app.json");

const GOOGLE_SERVICES_CANDIDATES = [
  process.env.GOOGLE_SERVICES_JSON,
  process.env.GOOGLE_SERVICES_FILE,
  process.env.GOOGLE_SERVICES_JSON_PATH,
  "./google-services.json",
  "./android/app/google-services.json",
].filter(Boolean);

function findGoogleServicesFile() {
  return GOOGLE_SERVICES_CANDIDATES.find((candidate) => {
    const candidatePath = path.isAbsolute(candidate)
      ? candidate
      : path.join(__dirname, candidate);

    return fs.existsSync(candidatePath);
  });
}

module.exports = ({ config }) => {
  const baseConfig = {
    ...appJson.expo,
    ...config,
    android: {
      ...appJson.expo.android,
      ...config.android,
    },
  };
  const googleServicesFile = findGoogleServicesFile();

  if (!googleServicesFile) {
    return baseConfig;
  }

  return {
    ...baseConfig,
    android: {
      ...baseConfig.android,
      googleServicesFile,
    },
  };
};
