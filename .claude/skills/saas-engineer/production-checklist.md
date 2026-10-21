# Production Checklist

Step-by-step deployment walkthrough for a Next.js + Supabase + Stripe SaaS. Follow in order.

**Source:** Phases 1-3 follow, in this file's own words, the setup sequence of MakerKit's public going-to-production documentation for its Next.js + Supabase starter kit (its production checklist and authentication-email pages); the database hardening items also match Supabase's own production checklist. No text is copied.

## Phase 1: Supabase Production Setup (30 min)

### 1.1 Create Production Project

1. Create a new Supabase project at supabase.com (separate from dev)
2. Save the database password securely (password manager, not a text file)
3. Link local project:

```bash
supabase login
supabase link --project-ref <your-project-ref>
```

### 1.2 Push Database Schema

```bash
supabase db push
```

Review each migration when prompted. Verify tables in the Supabase Dashboard Table Editor.

### 1.3 Enable Security

```sql
-- Verify RLS is enabled on every table
SELECT schemaname, tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public';
```

In Supabase Dashboard:
- [ ] Project Settings > Database > SSL Enforcement: **Enabled**
- [ ] Project Settings > Database > Network Restrictions: **Configured** (only allow your hosting provider's IPs if possible)
- [ ] Authentication > Providers > Email > Confirm Email: **Enabled**
- [ ] Authentication > Providers > Email > Secure Email Change: **Enabled**
- [ ] Authentication > URL Configuration > Site URL: your production domain
- [ ] Authentication > URL Configuration > Redirect URLs: `https://yourdomain.com/auth/callback**`

### 1.4 Configure Auth Email Templates

Replace default Supabase email templates with custom ones that handle the PKCE browser-switch issue (when users open email confirmation in a different browser).

Templates should redirect to your app's `/auth/callback` endpoint, not Supabase's default confirmation endpoint.

### 1.5 Set Up SMTP

Supabase's built-in email has strict rate limits. Configure a real provider:

In Project Settings > Authentication > SMTP Settings:

| Provider | SMTP Host | Port |
|----------|----------|------|
| Resend | `smtp.resend.com` | 465 |
| SendGrid | `smtp.sendgrid.net` | 587 |
| Postmark | `smtp.postmarkapp.com` | 587 |

Also configure DNS records: SPF, DKIM, DMARC for your domain.

## Phase 2: Hosting Deployment (20 min)

### 2.1 Vercel Setup

```bash
vercel link
vercel env pull .env.local  # check current config
```

### 2.2 Environment Variables

Set in Vercel Dashboard (Settings > Environment Variables):

**Public (client-safe):**

| Variable | Source |
|----------|--------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase Dashboard > Settings > API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase Dashboard > Settings > API |
| `NEXT_PUBLIC_SITE_URL` | Your production domain |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Stripe Dashboard > Developers > API Keys |

**Secret (server-only):**

| Variable | Source |
|----------|--------|
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase Dashboard > Settings > API |
| `STRIPE_SECRET_KEY` | Stripe Dashboard > API Keys (live mode) |
| `STRIPE_WEBHOOK_SECRET` | Stripe Dashboard > Webhooks > Signing secret |
| `OPENAI_API_KEY` | OpenAI Dashboard > API Keys |

**Gotcha:** When setting via CLI, use `printf` not `echo`:

```bash
# Correct
printf '%s' 'sk_live_xxx' | vercel env add STRIPE_SECRET_KEY production

# Wrong (adds trailing newline that breaks the key)
echo 'sk_live_xxx' | vercel env add STRIPE_SECRET_KEY production
```

### 2.3 Deploy

```bash
vercel --prod
```

Or push to `main` branch if Git integration is configured.

### 2.4 Custom Domain

In Vercel Dashboard > Domains:
1. Add your domain
2. Configure DNS records as shown (A record or CNAME)
3. Wait for SSL certificate (automatic, < 5 minutes)
4. Verify HTTPS works

## Phase 3: Stripe Live Mode (30 min)

### 3.1 Switch to Live Mode

In Stripe Dashboard, toggle from Test to Live mode.

### 3.2 Create Products and Prices

Create the same products/prices you have in test mode:

| Product | Price | Price ID |
|---------|-------|----------|
| Your plan | your price | `price_xxx` |

Update price IDs in your environment variables or config.

### 3.3 Create Webhook Endpoint

In Stripe Dashboard > Developers > Webhooks:

1. Add endpoint: `https://yourdomain.com/api/billing/webhook`
2. Select events:
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.paid`
   - `invoice.payment_failed`
3. Copy the signing secret to `STRIPE_WEBHOOK_SECRET` env var

### 3.4 Test End-to-End

1. Create a real purchase with a real card (Stripe test cards won't work in live mode)
2. Use a $0 coupon if you don't want to actually charge yourself
3. Verify:
   - [ ] Checkout completes
   - [ ] Webhook fires (check Stripe Dashboard > Webhooks > Recent events)
   - [ ] Database updated (subscription record created)
   - [ ] User has paid-tier access
   - [ ] Cancel subscription works
   - [ ] Re-subscribe works

## Phase 4: Monitoring Setup (15 min)

### 4.1 Sentry

```bash
npx @sentry/wizard@latest -i nextjs
```

Configure in `sentry.client.config.ts` and `sentry.server.config.ts`:
- Set `dsn` from Sentry project
- Set `environment` to distinguish production/staging
- Set `tracesSampleRate` to 0.1-0.5 (100% is expensive)

### 4.2 Uptime Monitoring

Set up a check on your `/api/health` endpoint:
- Check interval: 1-5 minutes
- Alert: email + Slack/Discord
- Check from multiple regions

Recommended: Betterstack (free tier), Checkly, or UptimeRobot.

### 4.3 Spending Alerts

| Service | Where | Alert At |
|---------|-------|----------|
| Vercel | Settings > Billing > Spend Management | $50, $100, $200 |
| OpenAI | Settings > Limits | 80% of monthly budget |
| Supabase | Project Settings > Billing | Approaching plan limits |
| Stripe | Dashboard > Settings > Alerts | Unusual activity |

## Phase 5: Post-Launch Hardening (Ongoing)

### First Week

- [ ] Monitor error rates in Sentry (expect some — fix the P0s immediately)
- [ ] Watch webhook success rate in Stripe
- [ ] Check database connection count (Supabase Dashboard)
- [ ] Review Core Web Vitals (Vercel Analytics)
- [ ] Set up log drain if error volume is high

### First Month

- [ ] Run `npm audit` and update vulnerable dependencies
- [ ] Review and optimize slowest database queries (Supabase > Database > Query Performance)
- [ ] Archive or clean up test data from production
- [ ] Document your infrastructure (what's where, how to access)
- [ ] Create a runbook for common incidents
- [ ] Set up database backups beyond Supabase defaults (if needed)

### Ongoing

- [ ] Monthly dependency updates (`npm outdated`, `npm update`)
- [ ] Quarterly security review (RLS policies, access patterns, secret rotation)
- [ ] Review Vercel/Supabase/OpenAI bills for anomalies
- [ ] Test disaster recovery (can you restore from backup?)
- [ ] Keep documentation current

## Quick Reference: Common Commands

```bash
# Vercel
vercel --prod                    # Deploy to production
vercel rollback                  # Revert to previous deployment
vercel logs --follow             # Tail production logs
vercel env ls                    # List environment variables

# Supabase
supabase db push                 # Apply migrations to remote
supabase db diff -f <name>       # Generate migration from changes
supabase db reset                # Reset local database
supabase inspect db              # Database inspection tools

# Stripe CLI
stripe listen --forward-to localhost:3000/api/billing/webhook  # Local webhook testing
stripe trigger checkout.session.completed                       # Test webhook events
stripe logs tail                                                # Tail API logs

# Debugging
npx why-is-node-running          # Find what's keeping the process alive
npx @next/bundle-analyzer        # Analyze client bundle size
npx source-map-explorer .next/static/chunks/*.js  # Check for leaked secrets in bundle
```
