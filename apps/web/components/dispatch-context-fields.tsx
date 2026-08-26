'use client'

import { useCallback, useEffect, useState } from 'react'

export function DispatchContextFields({
  defaultLocationLabel = '',
  defaultLatitude = '',
  defaultLongitude = '',
}: {
  defaultLocationLabel?: string
  defaultLatitude?: string
  defaultLongitude?: string
}) {
  const [timezone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC')
  const [etaAt, setEtaAt] = useState('')
  const [latitude, setLatitude] = useState(defaultLatitude)
  const [longitude, setLongitude] = useState(defaultLongitude)
  const [locationStatus, setLocationStatus] = useState(defaultLatitude && defaultLongitude ? 'Using the last recorded location.' : 'Location is optional until custody changes.')

  const requestCurrentLocation = useCallback((announceSearch = true) => {
    if (!navigator.geolocation) {
      setLocationStatus('Location is unavailable in this browser.')
      return
    }
    if (announceSearch) setLocationStatus('Finding current location…')
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLatitude(position.coords.latitude.toFixed(6))
        setLongitude(position.coords.longitude.toFixed(6))
        setLocationStatus('Current location added. The customer will see it only with this dispatch update.')
      },
      () => setLocationStatus('Location was not shared. You can still enter a place name.'),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
    )
  }, [])

  useEffect(() => {
    // Browsers must not prompt for location without a user gesture. Reuse an
    // existing grant automatically, while keeping the explicit button for a
    // first-time permission decision.
    if (!defaultLatitude && !defaultLongitude && navigator.permissions?.query) {
      void navigator.permissions
        .query({ name: 'geolocation' })
        .then((permission) => {
          if (permission.state === 'granted') requestCurrentLocation(false)
        })
        .catch(() => undefined)
    }
  }, [defaultLatitude, defaultLongitude, requestCurrentLocation])

  return (
    <>
      <input type="hidden" name="etaTimezone" value={timezone} />
      <input type="hidden" name="etaAt" value={etaAt} />
      <label className="grid gap-2 text-sm text-ink/72">
        Estimated arrival
        <input
          type="datetime-local"
          name="etaLocal"
          onChange={(event) => {
            const localDate = event.currentTarget.value
              ? new Date(event.currentTarget.value)
              : null
            setEtaAt(localDate && !Number.isNaN(localDate.getTime()) ? localDate.toISOString() : '')
          }}
          className="rounded-2xl border border-ink/10 bg-white px-4 py-3"
        />
        <span className="text-xs leading-5 text-ink/45">Shown to each person in their own timezone. Your entry uses {timezone}.</span>
      </label>
      <label className="grid gap-2 text-sm text-ink/72">
        Current location
        <input name="locationLabel" defaultValue={defaultLocationLabel} placeholder="e.g. Airport Residential, Accra" className="rounded-2xl border border-ink/10 bg-white px-4 py-3" />
      </label>
      <input type="hidden" name="latitude" value={latitude} />
      <input type="hidden" name="longitude" value={longitude} />
      <div className="grid content-end gap-2">
        <button type="button" onClick={() => requestCurrentLocation(true)} className="inline-flex w-fit cursor-pointer items-center justify-center rounded-full border border-ink/10 bg-white px-4 py-3 text-sm font-semibold text-needle transition-colors duration-200 hover:bg-mint/35 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-needle">
          Use current location
        </button>
        <p className="text-xs leading-5 text-ink/45">{locationStatus} · Times use {timezone}.</p>
      </div>
    </>
  )
}
