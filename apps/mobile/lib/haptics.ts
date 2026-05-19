import { trigger } from 'react-native-haptic-feedback'

const HAPTIC_OPTIONS = {
  enableVibrateFallback: true,
  ignoreAndroidSystemSettings: false,
} as const

export function hapticLight() {
  trigger('impactLight', HAPTIC_OPTIONS)
}

export function hapticSuccess() {
  trigger('notificationSuccess', HAPTIC_OPTIONS)
}

export function hapticWarning() {
  trigger('notificationWarning', HAPTIC_OPTIONS)
}
