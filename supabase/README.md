# Supabase + Google + Netlify

## Fix “redirects to localhost:3000”

That URL comes from **Supabase Site URL**, not from Netlify code.

1. Open [Supabase Dashboard](https://supabase.com/dashboard) → project `xzsynwcpzljzgaghetem`
2. **Authentication** → **URL Configuration**
3. Set:
   - **Site URL:** `https://lantaw.netlify.app`
   - **Redirect URLs** (one per line):
     - `https://lantaw.netlify.app/**`
     - `http://localhost/movie/**`
4. Save

If the Netlify URL is missing from Redirect URLs, Supabase ignores `redirectTo` and sends users to Site URL (often still `http://localhost:3000`).

## Google provider

1. **Authentication** → **Providers** → **Google** → enabled
2. Client ID + Secret must match Google Cloud
3. Google Cloud → OAuth client:
   - **Authorized JavaScript origins:** `https://lantaw.netlify.app`, `http://localhost`
   - **Authorized redirect URIs:** `https://xzsynwcpzljzgaghetem.supabase.co/auth/v1/callback`

## “Unable to exchange external code”

Usually wrong Client Secret, or Google redirect URI not exactly the Supabase callback above. Re-paste Client ID/Secret in Supabase and Save.
