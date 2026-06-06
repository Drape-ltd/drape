import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const mobileRoot = path.resolve(scriptDir, "..");
const androidTarget = path.join(mobileRoot, "android", "app", "google-services.json");

const candidatePaths = [
  process.env.GOOGLE_SERVICES_JSON,
  process.env.GOOGLE_SERVICES_FILE,
  process.env.GOOGLE_SERVICES_JSON_PATH,
  path.join(mobileRoot, "google-services.json"),
  androidTarget,
].filter(Boolean);

function resolveExistingCandidate() {
  for (const candidate of candidatePaths) {
    const candidatePath = path.isAbsolute(candidate)
      ? candidate
      : path.resolve(mobileRoot, candidate);

    if (fs.existsSync(candidatePath)) {
      return candidatePath;
    }
  }

  return null;
}

const source = resolveExistingCandidate();
const isProductionBuild =
  process.env.EXPO_PUBLIC_SUPABASE_ENV === "production" ||
  process.env.EXPO_PUBLIC_APP_VARIANT === "production";

if (!source) {
  const message =
    "Android Firebase config missing. Set GOOGLE_SERVICES_JSON as an EAS file variable or provide apps/mobile/google-services.json locally.";

  if (isProductionBuild) {
    throw new Error(message);
  }

  console.warn(`[mobile build] ${message}`);
  process.exit(0);
}

fs.mkdirSync(path.dirname(androidTarget), { recursive: true });

if (path.resolve(source) !== path.resolve(androidTarget)) {
  fs.copyFileSync(source, androidTarget);
}

console.log(`[mobile build] Prepared Android Firebase config at ${path.relative(mobileRoot, androidTarget)}.`);
