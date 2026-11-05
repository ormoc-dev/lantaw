# send-push

Delivers Chrome / PWA notifications when LANTAW is fully closed.

## Deploy

1. Run SQL: `supabase/migrations/202603300005_push_subscriptions.sql`
2. Set Edge secrets (from `.vapid-private.local` or `node scripts/generate-vapid.mjs`):

```bash
supabase secrets set VAPID_PUBLIC_KEY="..." VAPID_PRIVATE_KEY="..." VAPID_SUBJECT="mailto:hello@lantaw.app"
```

3. Deploy:

```bash
supabase functions deploy send-push --no-verify-jwt
```

Use JWT verification on if your CLI supports authenticated invoke (client sends the user Bearer token). Prefer:

```bash
supabase functions deploy send-push
```

4. Put the same `VITE_VAPID_PUBLIC_KEY` in Vercel env, then redeploy.
5. On each device: Me → Notifications → allow, once, while signed in.
