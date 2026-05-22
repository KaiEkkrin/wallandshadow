# Zitadel OIDC Setup

Wall & Shadow uses [Zitadel](https://zitadel.com/) as its external OIDC
provider. This is a one-time setup of the external service; for the day-to-day
development workflow see [DEVELOPMENT.md](DEVELOPMENT.md).

## 1. Create a Zitadel Instance

Sign up at [zitadel.cloud](https://zitadel.cloud/) (free tier available) or
self-host. Note your instance URL (e.g. `https://your-instance.eu1.zitadel.cloud`).

## 2. Create a Project

In the Zitadel console, create a **Project** (e.g. "Wall & Shadow").

**Token settings** — under the project's General tab, scroll to Token or find it
in settings:

- **Access Token Type**: set to **JWT**. This is critical — the default is
  opaque tokens, which the Wall & Shadow server cannot verify. The server
  validates access tokens against Zitadel's JWKS endpoint and needs them to be
  JWTs.

## 3. Create an Application

Inside the project, create a new **Application**:

- **Application type**: User Agent
- **Authentication method**: PKCE (selected by default for User Agent apps)

**OIDC Settings** (on the application's configuration page):

| Setting              | Value              |
| -------------------- | ------------------ |
| **Response Type**    | Code               |
| **Grant Type**       | Authorization Code |
| **Application Type** | User Agent         |
| **Auth Method**      | None (PKCE)        |

**Redirect URIs** — add all origins where the app runs:

| Environment     | URI                                     |
| --------------- | --------------------------------------- |
| Vite dev server | `http://localhost:5000/auth/callback`   |
| Production      | `https://your-domain.com/auth/callback` |

**Post Logout Redirect URIs** — same origins, pointing to the login page:

| Environment     | URI                             |
| --------------- | ------------------------------- |
| Vite dev server | `http://localhost:5000/login`   |
| Production      | `https://your-domain.com/login` |

Note the **Client ID** from the application page — you'll need it for the
environment variables below.

## 4. Configure Identity Providers (Social Login)

Identity providers are configured in Zitadel, not in the Wall & Shadow codebase.
Once configured, they automatically appear on Zitadel's hosted login page.

**Google:**

1. Create an OAuth 2.0 Client ID at [console.cloud.google.com/apis/credentials](https://console.cloud.google.com/apis/credentials) (type: Web application)
2. Set the **Authorized redirect URI** to: `https://your-instance.zitadel.cloud/ui/login/login/externalidp/callback`
3. In Zitadel: **Settings** > **Identity Providers** > **New** > **Google**
4. Paste the Google Client ID and Client Secret
5. Enable **Auto creation** (create Zitadel user on first Google login) and **Auto update** (sync profile changes)
6. Activate the provider

**GitHub:**

1. Create an OAuth App at [github.com/settings/developers](https://github.com/settings/developers) > **OAuth Apps** > **New OAuth App**
2. Set the **Authorization callback URL** to: `https://your-instance.zitadel.cloud/ui/login/login/externalidp/callback`
3. In Zitadel: **Settings** > **Identity Providers** > **New** > **GitHub**
4. Paste the GitHub Client ID and Client Secret
5. Enable auto-creation and auto-update, then activate

## 5. Enable Self-Registration

To allow users to create accounts with email/password on Zitadel's hosted login
page:

1. Go to **Settings** > **Login Behavior and Access**
2. Enable **Register allowed**

## 6. Create a Test User (for OIDC e2e tests)

Create a user in Zitadel with a known email and password for the automated OIDC
e2e test:

1. Go to **Users** > **Create User**
2. Set an email and password
3. Add these credentials to your `.devcontainer/.env` as `ZITADEL_TEST_EMAIL` and `ZITADEL_TEST_PASSWORD`

## 7. Environment Variables

Copy `.devcontainer/.env.example` to `.devcontainer/.env` and fill in the values:

```bash
# OIDC provider (Zitadel)
OIDC_ISSUER=https://your-instance.zitadel.cloud
VITE_OIDC_ISSUER=https://your-instance.zitadel.cloud
VITE_OIDC_CLIENT_ID=your-client-id-from-step-3

# Optional: Zitadel test user for the OIDC e2e test
#ZITADEL_TEST_EMAIL=test@example.com
#ZITADEL_TEST_PASSWORD=your-test-password
```

The `.devcontainer/.env` file is gitignored. The `--env-file` flag in
`devcontainer.json` injects these into the container environment on startup.

For terminals already open, source the env file:

```bash
export $(grep -v '^#' /workspaces/wallandshadow/.devcontainer/.env | xargs)
```
