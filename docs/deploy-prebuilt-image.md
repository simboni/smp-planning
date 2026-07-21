# Deploy from a prebuilt image (no Render build minutes)

Render's build pipeline has a monthly free-minute cap. To make deploys immune
to it, GitHub Actions builds the server image for free (public repo → unlimited
Actions minutes) and pushes it to the GitHub Container Registry (GHCR); Render
then just **pulls** the image instead of building it.

The workflow is `.github/workflows/server-image.yml`. It publishes:

```
ghcr.io/simboni/smp-planning:latest
```

on every push to the branch. Do the one-time Render setup below and every
future deploy costs **zero** Render build minutes.

## One-time setup

### 1. Make the image public
After the first workflow run, GitHub creates the package **private**. Open
`https://github.com/users/simboni/packages/container/smp-planning/settings`
→ **Change visibility → Public**. (Public means Render pulls it with no token.)

### 2. Create a Render service from the image
Render → **New → Web Service → Deploy an existing image**.
- **Image URL:** `ghcr.io/simboni/smp-planning:latest`
- **Instance type:** the same as now (Starter is fine).

### 3. Set the environment variables
Copy these from your current `stackup` service (Environment tab). Required:

| Key | Value |
| --- | --- |
| `APP_DB_URL` | Neon URL for the `stackup_app` role |
| `ADMIN_DB_URL` | Neon URL for the `stackup_migrator` role (auto-migrate) |
| `JWT_SECRET` | your long random secret |
| `WEB_ORIGINS` | `https://www.stackup.co.ke` |
| `WEB_BASE_URL` | `https://www.stackup.co.ke` |
| `OAUTH_REDIRECT_URI` | `https://www.stackup.co.ke/auth/oauth/google/callback` |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | the **new** OAuth client |
| `EMAIL_PROVIDER` | `http` |
| `EMAIL_RELAY_URL` | `https://api.resend.com/emails` |
| `EMAIL_RELAY_AUTH` | `Bearer re_…` (your Resend key) |
| `EMAIL_FROM` | `StackUp <no-reply@stackup.co.ke>` |

Optional: `ANTHROPIC_API_KEY`, `FCM_SERVICE_ACCOUNT`. Do **not** set `PORT` —
Render injects it and the app reads it automatically.

### 4. Move the custom domain
On the OLD service remove `www.stackup.co.ke`, then add it to the NEW image
service (Settings → Custom Domains). DNS already points at Render, so it just
re-attaches.

### 5. Auto-deploy on every new image
New image service → **Settings → Deploy Hook** → copy the URL. In GitHub →
repo **Settings → Secrets and variables → Actions → New repository secret**:
- Name: `RENDER_DEPLOY_HOOK`
- Value: the deploy-hook URL

Now every push builds the image on GitHub and pings Render to pull it — fully
automatic, no Render build minutes used.

## Deploying manually
Re-run the **Build & publish server image** workflow (Actions tab → Run
workflow), or in Render click **Manual Deploy** on the image service (it
re-pulls `:latest`).
