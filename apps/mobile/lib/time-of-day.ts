import { Colors } from '@/constants/theme'

export type TimeOfDayIcon = 'sun' | 'moon'

export type TimeOfDayGreeting = {
  label: string
  icon: TimeOfDayIcon
  iconColor: string
  iconBackground: string
}

export function getTimeOfDayGreeting(now = new Date()): TimeOfDayGreeting {
  const hour = now.getHours()

  if (hour < 12) {
    return {
      label: 'Good morning',
      icon: 'sun',
      iconColor: Colors.warning,
      iconBackground: Colors.statusPendingBg,
    }
  }

  if (hour < 17) {
    return {
      label: 'Good afternoon',
      icon: 'sun',
      iconColor: Colors.needleGreen,
      iconBackground: Colors.needleGreenLight,
    }
  }

  return {
    label: 'Good evening',
    icon: 'moon',
    iconColor: Colors.timeEvening,
    iconBackground: Colors.timeEveningBg,
  }
}

export function firstNameFromDisplayName(displayName: unknown) {
  if (typeof displayName !== 'string') return ''
  return displayName.trim().split(/\s+/)[0] ?? ''
}
