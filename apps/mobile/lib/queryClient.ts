import { QueryClient, focusManager } from '@tanstack/react-query'
import { AppState, type AppStateStatus } from 'react-native'

// Sync React Query's focus manager with the app's foreground/background state.
// This ensures queries refetch when the user returns to the app.
AppState.addEventListener('change', (status: AppStateStatus) => {
  focusManager.setFocused(status === 'active')
})

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime:  60_000,        // 1 min — data stays fresh for 1 min before background refetch
      gcTime:     5 * 60_000,    // 5 min — keep unused cache entries for 5 min
      retry:      1,
      refetchOnWindowFocus: true, // controlled by the AppState listener above
      refetchOnReconnect:   true,
    },
  },
})
