import { Stack } from 'expo-router'

export default function MessagesLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, gestureEnabled: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="[orderId]" />
    </Stack>
  )
}
