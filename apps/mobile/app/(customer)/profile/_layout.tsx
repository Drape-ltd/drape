import { Stack } from 'expo-router'
import { Colors } from '@/constants/theme'

export default function ProfileLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: Colors.bone },
        animation: 'slide_from_right',
      }}
    >
      <Stack.Screen name="index" />
      <Stack.Screen name="measurements" />
      <Stack.Screen name="guided-fit" />
      <Stack.Screen name="payments" />
      <Stack.Screen name="account-settings" />
      <Stack.Screen name="personal-info" />
      <Stack.Screen name="currency" />
      <Stack.Screen name="login-security" />
      <Stack.Screen name="notification-settings" />
      <Stack.Screen name="view-profile" />
      <Stack.Screen name="privacy" />
      <Stack.Screen name="data-request" />
      <Stack.Screen name="delete-account" />
      <Stack.Screen name="help" />
      <Stack.Screen name="notifications" />
      <Stack.Screen name="reviews" />
    </Stack>
  )
}
