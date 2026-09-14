import { getTurnstileSiteKey } from '../../../lib/supabase-config'

const ALLOWED_ACTIONS = new Set(['signin', 'signup', 'recovery'])

function safeJson(value: string) {
  return JSON.stringify(value).replace(/</g, '\\u003c')
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const requestedAction = url.searchParams.get('action') ?? ''
  const action = ALLOWED_ACTIONS.has(requestedAction) ? requestedAction : 'signin'
  const siteKey = getTurnstileSiteKey() ?? ''
  const nonce = request.headers.get('x-nonce') ?? ''

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
    <meta name="robots" content="noindex,nofollow" />
    <style>
      html, body { margin: 0; width: 100%; min-height: 100%; background: transparent; }
      body { display: flex; align-items: center; justify-content: center; overflow: hidden; }
      #challenge { width: 100%; display: flex; align-items: center; justify-content: center; }
      #status { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
    </style>
    <script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" defer></script>
  </head>
  <body>
    <div id="challenge"></div>
    <div id="status" role="status" aria-live="polite">Loading security check</div>
    <script nonce="${nonce}">
      (function () {
        var attempts = 0;
        var siteKey = ${safeJson(siteKey)};
        var action = ${safeJson(action)};

        function send(message) {
          var payload = JSON.stringify(message);
          if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
            window.ReactNativeWebView.postMessage(payload);
          }
        }

        function setStatus(value) {
          document.getElementById('status').textContent = value;
        }

        function renderChallenge() {
          if (!siteKey) {
            setStatus('Security verification is unavailable');
            send({ type: 'error', code: 'missing-site-key' });
            return;
          }

          if (!window.turnstile) {
            attempts += 1;
            if (attempts < 100) {
              window.setTimeout(renderChallenge, 100);
              return;
            }
            setStatus('Security check could not load');
            send({ type: 'error', code: 'script-timeout' });
            return;
          }

          window.turnstile.render('#challenge', {
            sitekey: siteKey,
            action: action,
            appearance: 'interaction-only',
            size: 'flexible',
            theme: 'light',
            retry: 'auto',
            'retry-interval': 2000,
            'refresh-expired': 'auto',
            'refresh-timeout': 'auto',
            callback: function (token) {
              setStatus('Security check complete');
              send({ type: 'success', token: token });
            },
            'expired-callback': function () {
              setStatus('Security check refreshing');
              send({ type: 'expired' });
            },
            'error-callback': function (code) {
              setStatus('Security check retrying');
              send({ type: 'error', code: String(code || 'unknown') });
            },
            'before-interactive-callback': function () {
              send({ type: 'interactive' });
            },
            'after-interactive-callback': function () {
              send({ type: 'idle' });
            }
          });
        }

        if (document.readyState === 'loading') {
          document.addEventListener('DOMContentLoaded', renderChallenge, { once: true });
        } else {
          renderChallenge();
        }
      }());
    </script>
  </body>
</html>`

  return new Response(html, {
    headers: {
      'Cache-Control': 'no-store, max-age=0',
      'Content-Type': 'text/html; charset=utf-8',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  })
}
