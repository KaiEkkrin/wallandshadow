# Wall & Shadow — Legacy Firebase Deployment Guide

**This doc applies only to the `legacy-firebase` branch.** `main` has been migrated
off Firebase. For the current (Hono + PostgreSQL + Hetzner) deployment story, see
@docs/REPLATFORM.md ("Production Deployment" section) and the deploy workflows at
`.github/workflows/deploy-server-{test,production}.yml`.

This guide is retained on `main` so that `workflow_dispatch` triggers for
`deploy-firebase.yml` / `deploy-test.yml` / `deploy-production.yml` remain visible
in the GitHub Actions UI (which only surfaces workflow files present on the default
branch). The actual Firebase configuration files referenced below
(`firebase.json`, `.firebaserc`, `firestore.rules`, etc.) only exist on the
`legacy-firebase` branch; dispatching these workflows from `main` will fail.

## Prerequisites

### 1. Firebase Project Setup

## Prerequisites

### 1. Firebase Project Setup

#### Create/Access Firebase Project

1. **Firebase Project**: Create or have access to a Firebase project at https://console.firebase.google.com

2. **Blaze Plan Required**: Wall & Shadow uses Cloud Functions and Cloud Storage, which require the Blaze (pay-as-you-go) plan
   - Upgrade at: https://console.firebase.google.com/project/YOUR_PROJECT_ID/usage
   - **Free tier included**: 2M function invocations/month, 5GB storage, generous Firestore quotas
   - **New projects**: Eligible for $300 Google Cloud credit

#### Enable Required Firebase Services

**Firebase Storage** (Required - must be set up before first deployment):

1. Visit: https://console.firebase.google.com/project/YOUR_PROJECT_ID/storage
2. Click **"Get Started"**
3. Select **"Start in production mode"** (security rules will be deployed from your code)
4. Choose a location for your default bucket (e.g., `europe-west2` to match Cloud Functions)
5. Click **"Done"**

**Firebase Authentication** (Required - enable before first use):

1. Visit: https://console.firebase.google.com/project/YOUR_PROJECT_ID/authentication/providers
2. Click **"Get started"** if prompted
3. Enable **Email/Password** provider:
   - Click "Email/Password" → Toggle "Enable" → Save
4. Enable **Google** provider:
   - Click "Add new provider" → "Google" → Toggle "Enable"
   - Enter project support email → Save

**Register Web App** (Required - enables Analytics and complete Firebase config):

1. Visit: https://console.firebase.google.com/project/YOUR_PROJECT_ID/settings/general
2. Scroll down to **"Your apps"** section
3. Click the **`</>`** icon (Web icon) to add a web app
4. **App nickname**: Enter a name (e.g., "Wall & Shadow Web")
5. **Firebase Hosting**: Check "Also set up Firebase Hosting for this app" ✅
6. **Choose hosting site**: Select `YOUR_PROJECT_ID` from the dropdown
7. Click **"Register app"**
8. Click **"Continue to console"** (skip the SDK setup instructions shown)

**Why this is needed**: Registering the web app adds the `appId` and `measurementId` to Firebase Hosting's auto-configuration, which is required for Firebase Analytics and prevents initialization errors.

**Firestore Database** (Auto-enabled on first deployment):

- No manual setup required - rules and indexes will be deployed automatically

### 2. Firebase CLI

```bash
# Install Firebase CLI globally
npm install -g firebase-tools

# Login to Firebase
firebase login

# Verify installation
firebase --version
```

### 3. Project Configuration

Your project uses `.firebaserc` to manage deployment targets:

```json
{
  "projects": {
    "default": "hexland-test-25", // Test/staging environment
    "production": "wallandshadow" // Production environment
  }
}
```

Switch between projects:

```bash
firebase use default      # Use test project
firebase use production   # Use production project
firebase use --add        # Add a new project alias
```

---

## Build Verification

Before deploying, ensure both the web app and Cloud Functions build successfully:

### Web Application

```bash
cd was-web
yarn build
```

**Expected output:**

- Build completes in ~5-10 seconds
- Main bundle: ~468KB (gzipped)
- Output directory: `build/`

### Cloud Functions

```bash
cd was-web/functions
yarn build
```

**Expected output:**

- TypeScript compilation succeeds
- Output directory: `lib/`

---

## Deployment Commands

### Deploy Everything (Recommended for First Deployment)

```bash
cd was-web
firebase deploy
```

**Deploys:**

- ✅ Web app (Hosting)
- ✅ Cloud Functions
- ✅ Firestore Security Rules
- ✅ Firestore Indexes
- ✅ Storage Security Rules

**Duration:** 3-5 minutes (first deployment), 1-2 minutes (subsequent)

---

### Deploy Specific Services

#### Hosting Only (Fastest)

```bash
firebase deploy --only hosting
```

Use this for quick frontend-only updates after initial deployment.

**Duration:** ~30 seconds

#### Functions Only

```bash
firebase deploy --only functions
```

Use when you've only changed Cloud Functions code.

**Duration:** ~1-2 minutes

#### Security Rules Only

```bash
firebase deploy --only firestore,storage
```

Use when you've only updated security rules.

**Duration:** ~10 seconds

#### Multiple Services

```bash
firebase deploy --only hosting,functions
```

Combine services with comma-separated list.

---

## Deployment Workflow

### First-Time Deployment

1. **Verify Blaze Plan**:

   - Visit: https://console.firebase.google.com/project/YOUR_PROJECT_ID/usage
   - Confirm "Blaze Plan" is active
   - If not, click "Modify Plan" → Upgrade to Blaze

2. **Enable Firebase Storage** (if not already done):

   - Visit: https://console.firebase.google.com/project/YOUR_PROJECT_ID/storage
   - Click "Get Started" → "Start in production mode" → Choose location → "Done"
   - See [Prerequisites](#enable-required-firebase-services) for details

3. **Configure CORS for Cloud Storage**:

   **Authenticate with Google Cloud SDK:**

   ```bash
   gcloud auth login
   ```

   This opens a browser window for authentication; sign in with the Google account that has access to your Firebase project.

   **Apply CORS configuration:**

   ```bash
   cd was-web
   gsutil cors set cors.json gs://YOUR_PROJECT_ID.firebasestorage.app
   ```

   Replace `YOUR_PROJECT_ID` with your actual Firebase project ID. For the production deployment, use the file `cors_production.json` rather than `cors.json`.

   **Bucket URL format:**

   - **New buckets** (created after Oct 2024): `gs://PROJECT_ID.firebasestorage.app`
   - **Old buckets** (created before Oct 2024): `gs://PROJECT_ID.appspot.com`

   Check your Firebase Console Storage page to confirm which format your bucket uses.

   **Verify CORS configuration:**

   ```bash
   gsutil cors get gs://YOUR_PROJECT_ID.firebasestorage.app
   ```

   You should see the CORS policy JSON output confirming the configuration was applied.

4. **Select Project**:

   ```bash
   firebase use default  # or firebase use production
   ```

5. **Build**:

   ```bash
   yarn build
   cd functions && yarn build && cd ..
   ```

6. **Deploy**:

   ```bash
   firebase deploy
   ```

7. **Verify**:
   - Web app: https://YOUR_PROJECT_ID.web.app
   - Firebase Console: https://console.firebase.google.com/project/YOUR_PROJECT_ID

---

### Subsequent Deployments

#### Frontend-Only Changes

```bash
cd was-web
yarn build
firebase deploy --only hosting
```

#### Backend-Only Changes

```bash
cd was-web/functions
yarn build
cd ..
firebase deploy --only functions
```

#### Full Deployment (Code + Rules + Indexes)

```bash
cd was-web
yarn build
firebase deploy
```

---

## Post-Deployment Verification

### 1. Web Application

Visit your deployed app:

- Primary URL: `https://YOUR_PROJECT_ID.web.app`
- Alternate URL: `https://YOUR_PROJECT_ID.firebaseapp.com`

**Test core functionality:**

- [ ] Sign up / Sign in (email/password, Google)
- [ ] Create adventure
- [ ] Create map (hex and square grid)
- [ ] Place tokens, draw walls
- [ ] Upload images
- [ ] Real-time sync (open map in two browsers)

### 2. Cloud Functions

List deployed functions:

```bash
firebase functions:list
```

**Expected output:**

```
┌──────────────────────┬────────────────┬──────────────┐
│ Name                 │ Region         │ Trigger      │
├──────────────────────┼────────────────┼──────────────┤
│ copyImage            │ europe-west2   │ HTTPS        │
│ deleteImage          │ europe-west2   │ HTTPS        │
│ exportSpritesheet    │ europe-west2   │ HTTPS        │
│ ...                  │ ...            │ ...          │
└──────────────────────┴────────────────┴──────────────┘
```

### 3. Monitor Function Logs

View real-time logs:

```bash
firebase functions:log
```

Or view in console:

- https://console.firebase.google.com/project/YOUR_PROJECT_ID/functions/logs

### 4. Firestore & Storage Rules

Verify rules deployed:

- Firestore: https://console.firebase.google.com/project/YOUR_PROJECT_ID/firestore/rules
- Storage: https://console.firebase.google.com/project/YOUR_PROJECT_ID/storage/rules

---

## Configuration Notes

### Region

Cloud Functions are deployed to **europe-west2** (London):

- Configured in: `was-web/functions/src/index.ts:16`
- Change if needed for different geographic region

### Emulator vs Production

The app automatically detects deployment environment:

- **Local development**: Uses Firebase emulators (no credentials needed)
- **Production**: Fetches config from `/__/firebase/init.json` (auto-provided by Firebase Hosting)

### Credentials

**Important:** `firebase-admin-credentials.json` is **only used locally** for development/testing:

- ✅ Development: Provides project ID for emulator connections
- ✅ Testing: E2E tests use it to determine project ID
- ❌ Production: **NOT deployed** (in `.gitignore`)
- ✅ Cloud Functions: Automatically use Application Default Credentials (ADC) when deployed

No manual credential management needed for production deployments.

---

## Troubleshooting

### Error: "HTTP Error: 403, Permission denied"

**Cause:** Not authenticated or wrong project selected.

**Solution:**

```bash
firebase login --reauth
firebase use YOUR_PROJECT_ID
```

### Error: "Functions did not deploy properly"

**Cause 1:** Not on Blaze plan.

**Solution:** Upgrade to Blaze plan in Firebase Console.

**Cause 2:** Missing Google Cloud APIs.

**Solution:** APIs will auto-enable on first deployment. If prompted, confirm API enablement.

### Error: "Build failed" during predeploy

**Cause:** TypeScript or lint errors in Functions code.

**Solution:**

```bash
cd was-web/functions
yarn lint
yarn build
```

Fix any reported errors before deploying.

### Error: "Firebase Storage has not been set up"

**Full error:**

```
Error: Firebase Storage has not been set up on project 'YOUR_PROJECT_ID'.
Go to https://console.firebase.google.com/project/YOUR_PROJECT_ID/storage
and click 'Get Started' to set up Firebase Storage.
```

**Cause:** Firebase Storage needs to be manually enabled before first deployment.

**Solution:**

1. Visit the link shown in the error message (or go to Firebase Console → Storage)
2. Click **"Get Started"**
3. Select **"Start in production mode"**
4. Choose a location (recommend `europe-west2` to match your Cloud Functions region)
5. Click **"Done"**
6. Retry deployment: `firebase deploy`

See [Prerequisites → Enable Required Firebase Services](#enable-required-firebase-services) for details.

### Error: "auth/configuration-not-found" When Signing Up

**Symptom:** Users get "Firebase: Error (auth/configuration-not-found)" when trying to sign up or log in.

**Cause:** Firebase Authentication providers (Email/Password, Google) are not enabled in the Firebase Console.

**Solution:**

1. Visit: https://console.firebase.google.com/project/YOUR_PROJECT_ID/authentication/providers
2. Click "Get started" if this is your first time
3. Enable Email/Password provider:
   - Click "Email/Password" → Toggle "Enable" → Click "Save"
4. Enable Google provider:
   - Click "Add new provider" → "Google" → Toggle "Enable"
   - Enter project support email → Click "Save"
5. Refresh your web app and try signing up again

### Error: "Missing App configuration value: appId" (Analytics Error)

**Full error:**

```
FirebaseError: Installations: Missing App configuration value: "appId"
(installations/missing-app-config-values).
```

**Symptom:** Error appears when accepting cookies or initializing Firebase Analytics in production.

**Cause:** Web app not registered with Firebase Hosting, so the auto-config endpoint (`/__/firebase/init.json`) is missing the `appId` field.

**Solution:**

1. Visit: https://console.firebase.google.com/project/YOUR_PROJECT_ID/settings/general
2. Scroll to "Your apps" section
3. Click the `</>` (Web) icon
4. Enter app nickname (e.g., "Wall & Shadow Web")
5. Check "Also set up Firebase Hosting for this app"
6. Select your hosting site from dropdown
7. Click "Register app" → "Continue to console"
8. Redeploy hosting: `firebase deploy --only hosting`
9. **Clear browser cache** (Ctrl+Shift+Delete) or test in incognito
10. Error should be resolved

See [Prerequisites → Register Web App](#register-web-app-required---enables-analytics-and-complete-firebase-config) for details.

### Functions Deployment is Slow

**Normal behavior:**

- First deployment: 3-5 minutes (builds Docker containers)
- Subsequent deployments: 1-2 minutes (reuses containers)

To speed up:

- Use `--only hosting` when possible
- Deploy functions separately: `--only functions`

### CORS Errors in Production

**Cause:** Cloud Storage bucket not configured for CORS.

**Solution:**

```bash
cd was-web
gsutil cors set cors.json gs://YOUR_PROJECT_ID.firebasestorage.app
```

---

## Cost Monitoring

### Set Budget Alerts

1. Visit: https://console.firebase.google.com/project/YOUR_PROJECT_ID/usage/billing
2. Click "Set budget"
3. Configure alert thresholds (e.g., $5, $10, $20)

### Monitor Usage

Check usage dashboard:

- https://console.firebase.google.com/project/YOUR_PROJECT_ID/usage

**Expected costs for low-traffic VTT:**

- Most usage stays within free tiers
- Typical monthly cost: $0-5

### Free Tier Limits (Blaze Plan)

- **Cloud Functions**: 2M invocations/month, 400K GB-seconds compute
- **Firestore**: 50K reads, 20K writes, 20K deletes per day
- **Cloud Storage**: 5 GB stored, 1 GB/day download
- **Hosting**: 10 GB/month transfer

---

## Rollback

### Using Firebase Hosting Versions

View deployment history:

```bash
firebase hosting:channel:list
```

Rollback to previous version:

1. Visit: https://console.firebase.google.com/project/YOUR_PROJECT_ID/hosting
2. Click "Release history"
3. Find previous working version
4. Click "⋮" → "Roll back to this release"

### Using Git Tags

The project uses git tags for major milestones:

- `v1.3.10-phase0`, `v1.3.10-phase1`
- `v1.4.0-phase2`, `v1.4.0-phase3-complete`

To roll back:

```bash
git checkout v1.4.0-phase3-complete
cd was-web
yarn build
firebase deploy
```

---

## CI/CD Integration (Optional)

See the instructions on the GitHub Actions: [test deployment](.github/workflows/deploy-test.yml), [production deployment](.github/workflows/deploy-production.yml).

---

## Additional Resources

- [Firebase CLI Reference](https://firebase.google.com/docs/cli)
- [Firebase Hosting Documentation](https://firebase.google.com/docs/hosting)
- [Cloud Functions Documentation](https://firebase.google.com/docs/functions)
- [Firestore Security Rules](https://firebase.google.com/docs/firestore/security/get-started)
- [Cloud Storage Security Rules](https://firebase.google.com/docs/storage/security)

---

## Quick Reference

```bash
# Switch projects
firebase use default              # Test/staging
firebase use production           # Production

# Build
cd was-web && yarn build

# Deploy everything
firebase deploy

# Deploy hosting only (fast)
firebase deploy --only hosting

# Deploy functions only
firebase deploy --only functions

# Deploy rules only
firebase deploy --only firestore,storage

# Monitor functions
firebase functions:log

# List deployed functions
firebase functions:list

# Check current project
firebase projects:list
```

---

**Ready to deploy?** Run `firebase deploy` from `was-web/` directory.
