import { Stack } from 'expo-router'

export default function TailorLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, gestureEnabled: false }}>
      <Stack.Screen name="[id]" />
    </Stack>
  )
}
