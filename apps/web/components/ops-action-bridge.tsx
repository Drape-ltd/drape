'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

type OpsActionResponse = {
  redirectTo?: string
}

function isOpsActionForm(form: HTMLFormElement) {
  const action = new URL(form.action, window.location.href)
  return form.method.toLowerCase() === 'post' && action.pathname === '/ops/action'
}

export function OpsActionBridge() {
  const router = useRouter()

  useEffect(() => {
    const handleSubmit = async (event: SubmitEvent) => {
      const form = event.target
      if (!(form instanceof HTMLFormElement) || !isOpsActionForm(form)) return

      event.preventDefault()
      const submitter =
        event.submitter instanceof HTMLButtonElement || event.submitter instanceof HTMLInputElement
          ? event.submitter
          : null
      const formData = new FormData(form)
      if (submitter?.name) formData.append(submitter.name, submitter.value)

      submitter?.setAttribute('aria-busy', 'true')
      if (submitter) submitter.disabled = true

      try {
        const response = await fetch(form.action, {
          method: 'POST',
          body: formData,
          credentials: 'same-origin',
          headers: { Accept: 'application/json' },
        })
        const payload = (await response.json()) as OpsActionResponse
        const nextLocation = payload.redirectTo || window.location.pathname + window.location.search
        window.history.replaceState(window.history.state, '', nextLocation)
        router.refresh()
      } catch {
        form.submit()
      } finally {
        submitter?.removeAttribute('aria-busy')
        if (submitter) submitter.disabled = false
      }
    }

    document.addEventListener('submit', handleSubmit)
    return () => document.removeEventListener('submit', handleSubmit)
  }, [router])

  return null
}
