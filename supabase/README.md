# Fix Google login: Unable to exchange external code

You reach Netlify again, but login fails. That means **Supabase cannot talk to Google** with the Client ID/Secret you saved (almost always `invalid_client` / wrong secret).

## Do this now (works for most people)

### 1. Reset the Google Client Secret

1. Open [Google Cloud Credentials](https://console.cloud.google.com/apis/credentials)
2. Open the **Web application** OAuth client (ID should start with `833921049517-...`)
3. Confirm:
   - **Authorized JavaScript origins**
     - `https://lantaw.netlify.app`
     - `http://localhost` (optional for local)
   - **Authorized redirect URIs** — must be exactly:
     ```
     https://xzsynwcpzljzgaghetem.supabase.co/auth/v1/callback
     ```
     (Do **not** put `lantaw.netlify.app` here — that belongs in origins only.)
4. Click **Reset secret** / **Add secret** → copy the **new** Client Secret (`GOCSPX-...`)

### 2. Paste into Supabase

1. Open [Google provider](https://supabase.com/dashboard/project/xzsynwcpzljzgaghetem/auth/providers)
2. Enable **Google**
3. Paste the **same** Client ID + the **new** Client Secret
4. Save

### 3. Confirm Site URL

[URL Configuration](https://supabase.com/dashboard/project/xzsynwcpzljzgaghetem/auth/url-configuration)

- Site URL: `https://lantaw.netlify.app`
- Redirect URLs: `https://lantaw.netlify.app/**`

### 4. Test

Incognito → `https://lantaw.netlify.app/` → Continue with Google

## Check logs if it still fails

Supabase → **Logs** → **Auth** — look for `invalid_client` / `Unauthorized`. That confirms the secret/ID pair is wrong.
