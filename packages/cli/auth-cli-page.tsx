'use client';
// app/auth/cli/page.tsx
//
// This page is opened in the browser during `engram login`.
// It reads the current Supabase session and redirects the tokens
// back to the CLI's local callback server on port 3741.
//
// The CLI starts: http://localhost:3741/callback
// This page redirects to: http://localhost:3741/callback?access_token=...&user_id=...&email=...

import { useEffect, useState } from 'react';
import { createClientComponentClient } from '@supabase/auth-ui-react/dist/common/theming';
import { useSearchParams } from 'next/navigation';

export default function CliAuthPage() {
  const params = useSearchParams();
  const redirect = params.get('redirect') || 'http://localhost:3741/callback';
  const [status, setStatus] = useState<'checking' | 'redirecting' | 'not_signed_in'>('checking');

  useEffect(() => {
    async function handleAuth() {
      // Dynamically import to avoid SSR issues
      const { createClientComponentClient } = await import('@supabase/auth-ui-react').catch(() => ({
        createClientComponentClient: null,
      }));

      // Use @supabase/ssr client
      const { createBrowserClient } = await import('@supabase/ssr');
      const supabase = createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      );

      const { data: { session } } = await supabase.auth.getSession();

      if (!session) {
        setStatus('not_signed_in');
        return;
      }

      setStatus('redirecting');

      // Pass tokens back to the CLI
      const callbackUrl = new URL(redirect);
      callbackUrl.searchParams.set('access_token', session.access_token);
      callbackUrl.searchParams.set('refresh_token', session.refresh_token || '');
      callbackUrl.searchParams.set('user_id', session.user.id);
      callbackUrl.searchParams.set('email', session.user.email || '');

      window.location.href = callbackUrl.toString();
    }

    handleAuth();
  }, [redirect]);

  return (
    <div className="min-h-screen bg-[#0d1117] flex items-center justify-center">
      <div className="text-center max-w-sm">
        <div className="text-[#7c3aed] text-5xl mb-6">⬡</div>
        <h1 className="text-[#e6edf3] text-2xl font-semibold mb-3">
          ENGRAM CLI
        </h1>

        {status === 'checking' && (
          <p className="text-[#8b949e] text-sm">Checking authentication...</p>
        )}

        {status === 'redirecting' && (
          <>
            <p className="text-[#3fb950] text-sm mb-2">✓ Authenticated</p>
            <p className="text-[#8b949e] text-sm">Redirecting back to your terminal...</p>
          </>
        )}

        {status === 'not_signed_in' && (
          <>
            <p className="text-[#f85149] text-sm mb-4">
              You are not signed in to ENGRAM.
            </p>
            <p className="text-[#8b949e] text-sm mb-6">
              Please{' '}
              <a
                href={`/login?redirect=${encodeURIComponent(
                  window.location.href
                )}`}
                className="text-[#7c3aed] underline hover:text-[#9d5cf2]"
              >
                sign in to ENGRAM
              </a>{' '}
              first, then run{' '}
              <code className="bg-[#161b22] px-1.5 py-0.5 rounded text-[#7c3aed] font-mono">
                engram login
              </code>{' '}
              again.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
