# Fix Google login: Unable to exchange external code

You reach the deployed app again, but login fails. That means **Supabase cannot talk to Google** with the Client ID/Secret you saved (almost always `invalid_client` / wrong secret).

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

### 3. Confirm Site URL (local + Netlify)

Google can create the user in Supabase while the **app** still lands on `/login` if the redirect URL / PKCE origin doesn’t match. The app now redirects back to **whatever origin you started from**.

[URL Configuration](https://supabase.com/dashboard/project/xzsynwcpzljzgaghetem/auth/url-configuration)

Add **all** of these under **Redirect URLs** (keep them listed even when Site URL is one of them):
- `http://localhost/movie/**`
- `http://localhost/movie/`
- `https://lantaw.netlify.app/**`
- `https://lantaw.netlify.app/`

**Site URL** can be the one you use most (`http://localhost/movie/` or `https://lantaw.netlify.app`).

Open the app at the **same** host you allowlisted (don’t start on `127.0.0.1` if only `localhost` is listed).

### 4. Test

Hard refresh → Continue with Google → you should land on home (`#/`), not login.
If login still shows, read the red error on the page (it explains redirect / session handoff failures).

## Check logs if it still fails

Supabase → **Logs** → **Auth** — look for `invalid_client` / `Unauthorized`. That confirms the secret/ID pair is wrong.

## Friends / Chat / Watch together

Run this SQL in Supabase ? SQL Editor:

- `supabase/migrations/202603260003_friends_chat_watch.sql`

Optional: enable Realtime for `friend_messages` (Database ? Replication) so chat updates live.

## Login IP monitor

Run this SQL in Supabase ? SQL Editor:

- `supabase/migrations/202603260004_login_ip_monitor.sql`

Table: `public.login_events` (`user_id`, `email`, `ip_address`, `user_agent`, `logged_in_at`, `login_date`).
