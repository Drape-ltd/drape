const fs = require("fs");
const path = require("path");

const appJson = require("./app.json");

const GOOGLE_SERVICES_CANDIDATES = [
  process.env.GOOGLE_SERVICES_JSON,
  process.env.GOOGLE_SERVICES_FILE,
  process.env.GOOGLE_SERVICES_JSON_PATH,
].filter(Boolean);

const APP_IDENTITIES = {
  development: {
    name: "Drapeon Dev",
    scheme: "drape-dev",
    iosBundleIdentifier: "co.drapeon.app.dev",
  },
  preview: {
    name: "Drapeon Preview",
    scheme: "drape-preview",
    iosBundleIdentifier: "co.drapeon.app.preview",
  },
  testflight: {
    name: "Drapeon",
    scheme: "drape",
    iosBundleIdentifier: "co.drapeon.app",
  },
  production: {
    name: "Drapeon",
    scheme: "drape",
    iosBundleIdentifier: "co.drapeon.app",
  },
};

function findGoogleServicesFile() {
  return GOOGLE_SERVICES_CANDIDATES.find((candidate) => {
    const candidatePath = path.isAbsolute(candidate)
      ? candidate
      : path.join(__dirname, candidate);

    return fs.existsSync(candidatePath);
  });
}

module.exports = ({ config = {} } = {}) => {
  const variant = process.env.EXPO_PUBLIC_APP_VARIANT || "development";
  const identity = APP_IDENTITIES[variant];

  if (!identity) {
    throw new Error(
      `Unknown EXPO_PUBLIC_APP_VARIANT "${variant}". Expected one of ${Object.keys(APP_IDENTITIES).join(", ")}.`
    );
  }

  const baseConfig = {
    ...appJson.expo,
    ...config,
    name: identity.name,
    scheme: identity.scheme,
    ios: {
      ...appJson.expo.ios,
      ...config.ios,
      bundleIdentifier: identity.iosBundleIdentifier,
    },
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
