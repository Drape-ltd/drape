import { Stack } from 'expo-router'

export default function TailorClientsLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, gestureEnabled: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="[clientId]" />
      <Stack.Screen name="diary/[id]" />
      <Stack.Screen name="review/[orderId]" />
    </Stack>
  )
}
