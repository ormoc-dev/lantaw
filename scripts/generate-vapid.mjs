/**
 * Generate Web Push VAPID keys for closed-app Chrome notifications.
 * Usage: node scripts/generate-vapid.mjs
 */
import webpush from "web-push";

const keys = webpush.generateVAPIDKeys();
console.log(`
Add to .env (and Vercel):
VITE_VAPID_PUBLIC_KEY=${keys.publicKey}

Add to Supabase → Edge Functions → Secrets (NOT the client):
VAPID_PUBLIC_KEY=${keys.publicKey}
VAPID_PRIVATE_KEY=${keys.privateKey}
VAPID_SUBJECT=mailto:hello@lantaw.app

Then: npm run sync-env
`);
