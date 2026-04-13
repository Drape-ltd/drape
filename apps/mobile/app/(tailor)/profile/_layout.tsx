import { Stack } from 'expo-router'
import { Colors } from '@/constants/theme'

export default function TailorProfileLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: Colors.bone },
        animation: 'slide_from_right',
      }}
    >
      <Stack.Screen name="index" />
      <Stack.Screen name="setup" />
      <Stack.Screen name="notifications" />
      <Stack.Screen name="help" />
      <Stack.Screen name="account-settings" />
      <Stack.Screen name="trust-access" />
      <Stack.Screen name="access-review" />
      <Stack.Screen name="personal-info" />
      <Stack.Screen name="login-security" />
      <Stack.Screen name="notification-settings" />
      <Stack.Screen name="portfolio" />
      <Stack.Screen name="edit" />
    </Stack>
  )
}
