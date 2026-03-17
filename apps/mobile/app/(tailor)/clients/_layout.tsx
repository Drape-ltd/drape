import { Stack } from 'expo-router'

export default function TailorClientsLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="[clientId]" />
      <Stack.Screen name="diary/[id]" />
    </Stack>
  )
}
