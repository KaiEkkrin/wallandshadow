# GitHub Environments Setup Guide

**This guide applies only to the `legacy-firebase` branch.** `main` deploys via
`deploy-server-{test,production}.yml` to Hetzner; see @docs/REPLATFORM.md
("Production Deployment") for the current setup.

This guide walks you through setting up GitHub Environments for deploying Wall & Shadow to test and production Firebase projects.

## Overview

Wall & Shadow uses GitHub's **Environments** feature to manage environment-specific secrets and deployment workflows:

- **test** environment: Auto-deploys on push to main
- **production** environment: Manual deployment only

Each environment has its own Firebase project and service account credentials.

## Prerequisites

1. Two Firebase projects:
   - Test/staging project (e.g., `hexland-test-25`)
   - Production project (e.g., `wallandshadow`)

2. GitHub repository with admin access

3. Service account keys for both Firebase projects (generated below)

## Step-by-Step Setup

### Part 1: Create GitHub Environments

#### 1.1 Create the "test" Environment

1. Go to your GitHub repository
2. Click **"Settings"** tab
3. In the left sidebar, click **"Environments"**
4. Click **"New environment"**
5. Name: `test`
6. Click **"Configure environment"**
7. Configure protection rules (optional but recommended):
   - **Deployment branches**: Click "Add deployment branch rule"
     - Select "Selected branches"
     - Add pattern: `main`
     - This ensures only main branch can deploy to test
   - **Required reviewers**: Leave empty (we want auto-deploy)
   - **Wait timer**: Leave empty
8. Scroll down to **"Environment secrets"** section (you'll add secrets in Part 2)

#### 1.2 Create the "production" Environment

1. Still in Settings → Environments
2. Click **"New environment"**
3. Name: `production`
4. Click **"Configure environment"**
5. Configure protection rules (RECOMMENDED for production):
   - **Deployment branches**: Click "Add deployment branch rule"
     - Select "Selected branches"
     - Add pattern: `main`
     - This ensures only main branch can deploy to production
   - **Required reviewers** (GitHub Enterprise only):
     - If you have Enterprise, add trusted team members
     - They will need to approve each production deployment
   - **Wait timer** (optional):
     - Set a delay (e.g., 5 minutes) before deployment starts
     - Gives you time to cancel if needed
6. Scroll down to **"Environment secrets"** section (you'll add secrets in Part 2)

---

### Part 2: Generate Firebase Service Account Keys

You need to generate a service account key for **each** Firebase project.

⚠️ **IMPORTANT**: Use DIFFERENT service accounts for test and production!

#### 2.1 Generate Test Environment Service Account

1. Go to [Firebase Console](https://console.firebase.google.com)
2. Select your **TEST** project (e.g., "hexland-test-25")
3. Click the **gear icon (⚙️)** → **"Project settings"**
4. Navigate to the **"Service Accounts"** tab
5. Click **"Generate New Private Key"** button
6. Click **"Generate Key"** to confirm
7. A JSON file will download (e.g., `hexland-test-25-firebase-adminsdk-xxxxx-xxxxxxxxxx.json`)
8. **Rename the file immediately** for easier tracking:
   ```bash
   mv hexland-test-25-firebase-adminsdk-*.json firebase-test-github-actions-2024-12-24.json
   ```
9. **Keep this file secure** - you'll encode it in the next step

#### 2.2 Generate Production Environment Service Account

1. Still in [Firebase Console](https://console.firebase.google.com)
2. Switch to your **PRODUCTION** project (e.g., "wallandshadow")
3. Click the **gear icon (⚙️)** → **"Project settings"**
4. Navigate to the **"Service Accounts"** tab
5. Click **"Generate New Private Key"** button
6. Click **"Generate Key"** to confirm
7. A JSON file will download (e.g., `wallandshadow-firebase-adminsdk-xxxxx-xxxxxxxxxx.json`)
8. **Rename the file immediately**:
   ```bash
   mv wallandshadow-firebase-adminsdk-*.json firebase-production-github-actions-2024-12-24.json
   ```
9. **Keep this file secure** - you'll encode it in the next step

---

### Part 3: Grant Firebase Admin Permissions

The service accounts need permissions to deploy to Firebase.

#### 3.1 Grant Permissions to Test Service Account

1. Go to [Google Cloud Console IAM](https://console.cloud.google.com/iam-admin/iam)
2. **Select your TEST project** from the dropdown at the top (e.g., "hexland-test-25")
3. Find your Firebase Admin SDK service account in the list:
   - Look for: `firebase-adminsdk-xxxxx@YOUR-TEST-PROJECT-ID.iam.gserviceaccount.com`
   - Example: `firebase-adminsdk-ab12c@hexland-test-25.iam.gserviceaccount.com`
   - (Ignore other Google-managed accounts like `gcf-admin-robot`)
4. Click the **✏️ (pencil/edit)** icon for that service account
5. Click **"Add Another Role"**
6. In the role dropdown, search for: `Firebase Admin`
7. Select **"Firebase Admin"**
8. Click **"Save"**
9. **Wait 2-5 minutes** for IAM changes to propagate

#### 3.2 Grant Permissions to Production Service Account

1. Still in [Google Cloud Console IAM](https://console.cloud.google.com/iam-admin/iam)
2. **Switch to your PRODUCTION project** from the dropdown at the top (e.g., "wallandshadow")
3. Find your Firebase Admin SDK service account in the list:
   - Look for: `firebase-adminsdk-xxxxx@YOUR-PRODUCTION-PROJECT-ID.iam.gserviceaccount.com`
   - Example: `firebase-adminsdk-ab12c@wallandshadow.iam.gserviceaccount.com`
4. Click the **✏️ (pencil/edit)** icon for that service account
5. Click **"Add Another Role"**
6. In the role dropdown, search for: `Firebase Admin`
7. Select **"Firebase Admin"**
8. Click **"Save"**
9. **Wait 2-5 minutes** for IAM changes to propagate

**Alternative (More Secure for Production):**

Instead of the broad "Firebase Admin" role, you can grant granular permissions:
- Service Account User
- Service Usage Consumer
- Cloud Storage for Firebase Viewer
- Firebase Hosting Admin
- Cloud Functions Admin
- Firebase Rules Admin
- Cloud Datastore Index Admin

This is more secure but requires more setup. For small projects, "Firebase Admin" is acceptable.

---

### Part 4: Encode Service Account Keys to Base64

GitHub secrets work best with base64-encoded data to avoid issues with special characters.

#### 4.1 Encode Test Service Account

**On Linux/macOS/WSL:**
```bash
cd /path/to/downloads
cat firebase-test-github-actions-2024-12-24.json | base64 -w 0 > test-encoded.txt
```

**On Windows PowerShell:**
```powershell
cd C:\path\to\downloads
[Convert]::ToBase64String([IO.File]::ReadAllBytes("firebase-test-github-actions-2024-12-24.json")) | Out-File -Encoding ASCII test-encoded.txt
```

The `-w 0` flag (Linux/macOS) prevents line wrapping, which is critical.

#### 4.2 Encode Production Service Account

**On Linux/macOS/WSL:**
```bash
cd /path/to/downloads
cat firebase-production-github-actions-2024-12-24.json | base64 -w 0 > production-encoded.txt
```

**On Windows PowerShell:**
```powershell
cd C:\path\to\downloads
[Convert]::ToBase64String([IO.File]::ReadAllBytes("firebase-production-github-actions-2024-12-24.json")) | Out-File -Encoding ASCII production-encoded.txt
```

You should now have:
- `test-encoded.txt` (base64-encoded test service account)
- `production-encoded.txt` (base64-encoded production service account)

---

### Part 5: Add Secrets to GitHub Environments

Now we'll add the encoded service account keys and project IDs to the GitHub Environments.

#### 5.1 Add Secrets to "test" Environment

1. Go to your GitHub repository
2. Click **"Settings"** → **"Environments"**
3. Click on the **"test"** environment
4. Scroll down to **"Environment secrets"**

**Add FIREBASE_SERVICE_ACCOUNT:**
1. Click **"Add secret"**
2. Name: `FIREBASE_SERVICE_ACCOUNT`
3. Value: Open `test-encoded.txt` and **copy the entire contents** (it will be a very long single line)
4. Click **"Add secret"**

**Add FIREBASE_PROJECT_ID:**
1. Click **"Add secret"**
2. Name: `FIREBASE_PROJECT_ID`
3. Value: Your test Firebase project ID (e.g., `hexland-test-25`)
   - Find this in Firebase Console or `.firebaserc` file
4. Click **"Add secret"**

#### 5.2 Add Secrets to "production" Environment

1. Still in Settings → Environments
2. Click on the **"production"** environment
3. Scroll down to **"Environment secrets"**

**Add FIREBASE_SERVICE_ACCOUNT:**
1. Click **"Add secret"**
2. Name: `FIREBASE_SERVICE_ACCOUNT`
3. Value: Open `production-encoded.txt` and **copy the entire contents**
4. Click **"Add secret"**

**Add FIREBASE_PROJECT_ID:**
1. Click **"Add secret"**
2. Name: `FIREBASE_PROJECT_ID`
3. Value: Your production Firebase project ID (e.g., `wallandshadow`)
   - Find this in Firebase Console or `.firebaserc` file
4. Click **"Add secret"**

---

### Part 6: Clean Up Sensitive Files

⚠️ **IMPORTANT**: Delete all credential files from your local machine!

```bash
# Delete original JSON files
rm firebase-test-github-actions-2024-12-24.json
rm firebase-production-github-actions-2024-12-24.json

# Delete encoded files
rm test-encoded.txt
rm production-encoded.txt

# Verify they're gone
ls -la firebase-*.json test-encoded.txt production-encoded.txt
# Should show "No such file or directory"
```

**On Windows:**
```powershell
Remove-Item firebase-test-github-actions-2024-12-24.json
Remove-Item firebase-production-github-actions-2024-12-24.json
Remove-Item test-encoded.txt
Remove-Item production-encoded.txt
```

---

## Verification

### Test the "test" Environment Workflow

1. Make a trivial commit to the main branch:
   ```bash
   git checkout main
   echo "# Test deployment" >> README.md
   git add README.md
   git commit -m "Test: Verify test environment deployment"
   git push origin main
   ```

2. Go to GitHub → **Actions** tab
3. You should see **"Deploy to Test"** workflow running
4. Click on it to monitor progress
5. Verify it completes successfully
6. Check your test Firebase project: `https://YOUR-TEST-PROJECT-ID.web.app`

### Test the "production" Environment Workflow

⚠️ **Don't test production with a throwaway commit!** Only deploy production when you have real changes ready.

When you're ready to deploy to production:

1. Go to GitHub → **Actions** tab
2. Click **"Deploy to Production"** workflow
3. Click **"Run workflow"** dropdown
4. Select **"main"** branch
5. Click **"Run workflow"**
6. Monitor the deployment
7. Verify: `https://YOUR-PRODUCTION-PROJECT-ID.web.app`

---

## Troubleshooting

### "Resource not accessible by integration" Error

**Cause:** The GITHUB_TOKEN doesn't have permission to access the environment.

**Solution:** Ensure the environment name in the workflow file exactly matches the environment name in Settings (case-sensitive):
- Workflow: `environment: test`
- Settings: Environment name must be `test` (not `Test` or `TEST`)

### "Secret FIREBASE_SERVICE_ACCOUNT not found" Error

**Cause:** The secret is not set in the environment, or the environment name is wrong.

**Solution:**
1. Check Settings → Environments → [environment name] → Environment secrets
2. Verify `FIREBASE_SERVICE_ACCOUNT` exists
3. Verify `FIREBASE_PROJECT_ID` exists
4. Verify the environment name matches exactly

### "Permission denied" During Deployment

**Cause:** Service account doesn't have Firebase Admin role, or IAM changes haven't propagated yet.

**Solution:**
1. Verify the service account has "Firebase Admin" role in Google Cloud Console → IAM
2. Wait 5 minutes for IAM changes to propagate
3. Try the deployment again

### Deployment Succeeds but App Doesn't Update

**Cause:** Deploying to the wrong Firebase project.

**Solution:**
1. Check the deployment logs for the project ID: `firebase deploy --project YOUR_PROJECT_ID`
2. Verify `FIREBASE_PROJECT_ID` secret matches the intended project
3. Verify you're checking the correct URL (test vs production)

---

## Next Steps

### Migrate from Old deploy.yml Workflow

The old `deploy.yml` workflow is deprecated. To migrate:

1. **Option 1: Remove it entirely** (recommended once new workflows are tested):
   ```bash
   git rm .github/workflows/deploy.yml
   git commit -m "Remove deprecated deploy.yml workflow"
   git push
   ```

2. **Option 2: Disable it** (keep for reference):
   - Rename: `deploy.yml` → `deploy.yml.disabled`
   - GitHub won't run `.disabled` files

3. **Option 3: Keep it temporarily** (already has deprecation notice):
   - Leave it as-is for backward compatibility
   - Remove later once confident in new workflows

### Delete Old Repository-Level Secrets (Optional)

If you had repository-level secrets `FIREBASE_SERVICE_ACCOUNT` and `FIREBASE_PROJECT_ID`, you can delete them after migrating to environment-scoped secrets:

1. Go to Settings → Secrets and variables → Actions
2. Under "Repository secrets", delete:
   - `FIREBASE_SERVICE_ACCOUNT`
   - `FIREBASE_PROJECT_ID`

This ensures only environment-scoped secrets are used.

---

## Security Best Practices

### Regular Key Rotation

Rotate service account keys every 90 days:

1. Generate new service account key (Firebase Console)
2. Encode to base64
3. Update the environment secret in GitHub
4. Test deployment
5. Delete old key from Google Cloud Console → Service Accounts → Keys

### Monitoring

- Review GitHub audit log periodically: Settings → Security → Audit log
- Monitor Firebase usage: Firebase Console → Usage and billing
- Set up budget alerts in Google Cloud Console

### Access Control

- Limit who can access production environment secrets
- Use required reviewers for production deployments (GitHub Enterprise)
- Never share service account keys outside of GitHub Environments

---

## Summary

You should now have:

- ✅ Two GitHub Environments (`test`, `production`)
- ✅ Environment-scoped secrets for each Firebase project
- ✅ Auto-deploy workflow for test environment
- ✅ Manual-deploy workflow for production environment
- ✅ Service account keys with proper permissions
- ✅ All sensitive files deleted from local machine

**Test environment:** Pushes to main automatically deploy to test
**Production environment:** Manually triggered via GitHub Actions UI

For questions or issues, refer to the workflow files:
- [deploy-firebase.yml](deploy-firebase.yml) - Shared deployment logic
- [deploy-test.yml](deploy-test.yml) - Test environment configuration
- [deploy-production.yml](deploy-production.yml) - Production environment configuration
