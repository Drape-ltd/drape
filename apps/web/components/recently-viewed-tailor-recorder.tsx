'use client'

import { useEffect } from 'react'
import { recordRecentlyViewedTailor } from '../lib/recently-viewed-tailors'
import { createClient } from '../lib/supabase'

export function RecentlyViewedTailorRecorder(props: {
  tailor: { id: string; displayName: string; location: string; photo: string | null }
}) {
  useEffect(() => {
    void createClient()
      .auth.getUser()
      .then(({ data }) => {
        if (data.user) recordRecentlyViewedTailor(data.user.id, props.tailor)
      })
  }, [props.tailor])
  return null
}
