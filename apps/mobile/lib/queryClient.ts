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
      staleTime:  2 * 60_000,    // 2 min — keep recently visited screens warm by default
      gcTime:     30 * 60_000,   // 30 min — hold onto cache longer for weak or expensive networks
      retry:      1,
      refetchOnWindowFocus: false, // screen-level focus refresh is handled explicitly where needed
      refetchOnReconnect:   true,
    },
  },
})
