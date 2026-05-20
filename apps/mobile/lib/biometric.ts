/**
 * Biometric utility
 *
 * Wraps expo-local-authentication and expo-secure-store to provide a simple
 * API for checking hardware support, reading/writing the user's biometric
 * preference, and triggering authentication.
 */

// expo-local-authentication is a native module — not available in Expo Go.
// We lazy-require it so the app degrades gracefully instead of crashing on import.
let LocalAuthentication: typeof import('expo-local-authentication') | null = null
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- native module must be lazy so Expo Go can degrade cleanly.
  LocalAuthentication = require('expo-local-authentication')
} catch {
  // Running in Expo Go — biometrics unavailable
}

import * as SecureStore from 'expo-secure-store'

const BIOMETRIC_PREF_KEY = 'drape_biometric_enabled'

/** Returns true if the device has enrolled biometric credentials. */
export async function isBiometricAvailable(): Promise<boolean> {
  if (!LocalAuthentication) return false
  const hasHardware = await LocalAuthentication.hasHardwareAsync()
  if (!hasHardware) return false
  return LocalAuthentication.isEnrolledAsync()
}

/**
 * Returns a human-readable label for the strongest available auth type:
 * "Face ID", "Fingerprint", or generic "Biometrics".
 */
export async function getBiometricLabel(): Promise<string> {
  if (!LocalAuthentication) return 'Biometrics'
  const types = await LocalAuthentication.supportedAuthenticationTypesAsync()
  if (types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) {
    return 'Face ID'
  }
  if (types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) {
    return 'Fingerprint'
  }
  return 'Biometrics'
}

/** Returns true if the user has opted in to biometric lock. */
export async function isBiometricEnabled(): Promise<boolean> {
  const val = await SecureStore.getItemAsync(BIOMETRIC_PREF_KEY)
  return val === 'true'
}

/** Persists the user's biometric lock preference. */
export async function setBiometricEnabled(enabled: boolean): Promise<void> {
  await SecureStore.setItemAsync(BIOMETRIC_PREF_KEY, enabled ? 'true' : 'false')
}

/**
 * Prompts the user for biometric (or device PIN fallback) authentication.
 * Returns true on success, false on cancellation or failure.
 */
export async function authenticate(reason?: string): Promise<boolean> {
  if (!LocalAuthentication) return false
  const result = await LocalAuthentication.authenticateAsync({
    promptMessage: reason ?? 'Verify your identity to access Drape',
    cancelLabel: 'Use password',
    disableDeviceFallback: false,
  })
  return result.success
}
