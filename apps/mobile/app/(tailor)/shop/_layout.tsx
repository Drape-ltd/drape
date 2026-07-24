import { Stack } from 'expo-router'

export default function TailorShopLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, gestureEnabled: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="new" />
    </Stack>
  )
}
