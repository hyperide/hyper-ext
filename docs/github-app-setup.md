# GitHub App Setup Guide

This guide explains how to create and configure a GitHub App for local development.

## Why GitHub App?

The project uses two GitHub integrations:

1. **GitHub OAuth App** — for user authentication (login with GitHub)
2. **GitHub App** — for repository access (cloning private repos, pushing commits)

GitHub App provides granular permissions and installation tokens that are more secure than storing user's personal access tokens.

## Step 1: Create GitHub App

1. Go to [GitHub Developer Settings](https://github.com/settings/apps)
2. Click **New GitHub App**
3. Fill in the basic info:
   - **GitHub App name**: Something unique, e.g., `hypercanvas-dev-yourname`
   - **Homepage URL**: `http://localhost:8080` (or your tunnel URL)
   - **Description**: Optional

## Step 2: Configure Callback & Webhook URLs

### Callback URL (Post Installation)

```text
http://localhost:8080/api/github-app/callback
```

For tunnel (e.g., ngrok, cloudflare):

```text
https://your-tunnel.example.com/api/github-app/callback
```

### Webhook URL

```text
http://localhost:8080/api/github-app/webhook
```

For tunnel:

```text
https://your-tunnel.example.com/api/github-app/webhook
```

**Note**: Webhooks require a publicly accessible URL. For local development, use a tunnel service like ngrok, cloudflare tunnel, or similar.

### Webhook Secret

Generate a random secret:

```bash
openssl rand -hex 32
```

Save this value — you'll need it for `GITHUB_APP_WEBHOOK_SECRET`.

## Step 3: Configure Permissions

Under **Permissions & events**, set:

### Repository Permissions

| Permission | Access |
|------------|--------|
| Contents | Read and write |
| Metadata | Read-only |
| Pull requests | Read and write (optional) |
| Issues | Read and write (optional) |

### Account Permissions

| Permission | Access |
|------------|--------|
| Email addresses | Read-only |

### Subscribe to Events

Check these webhooks:

- [x] Installation and uninstallation
- [x] Repository

## Step 4: Generate Private Key

After creating the app:

1. Scroll down to **Private keys** section
2. Click **Generate a private key**
3. A `.pem` file will be downloaded
4. Convert to single-line format for `.env`:

```bash
# Convert multi-line PEM to single line (escape newlines)
awk 'NF {sub(/\r/, ""); printf "%s\\n",$0;}' your-app.private-key.pem
```

Or use this command to copy directly:

```bash
cat your-app.private-key.pem | sed ':a;N;$!ba;s/\n/\\n/g' | pbcopy
```

## Step 5: Get App ID and Update Code

After creating the app, note the **App ID** shown at the top of the app settings page.

### Configure App Slug

The app slug is the URL-friendly name you chose during creation (visible in the app's public URL: `https://github.com/apps/YOUR-SLUG`).

Set it in your `.env`:

```bash
GITHUB_APP_SLUG=hypercanvas-dev-yourname
```

Default value is `hyperide` (production app).

## Step 6: Environment Variables

Add these to your `.env` file:

```bash
# GitHub App Configuration
GITHUB_APP_ID=123456
GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\nMIIE...\n-----END RSA PRIVATE KEY-----\n"
GITHUB_APP_WEBHOOK_SECRET=your-webhook-secret-from-step-2

# Optional: App slug for installation URL (if you modify the code)
GITHUB_APP_SLUG=hypercanvas-dev-yourname
```

**Note**: The private key must have `\n` escaped newlines when stored in `.env`.

## Step 7: Testing the Integration

1. Start the server:

   ```bash
   bun run dev
   ```

2. Check if GitHub App is configured:

   ```bash
   curl http://localhost:8080/api/github-app/status
   # Expected: {"configured":true}
   ```

3. Get installation URL (requires authentication):
   - Log in to the application
   - Navigate to settings or use the API

4. Install the app on a test repository:
   - Follow the installation URL
   - Select repositories to grant access
   - Complete the installation flow

5. Verify installation was saved:
   - Check the database `github_app_installations` table
   - Or use the API: `GET /api/github-app/installations`

## Troubleshooting

### "GitHub App not configured"

Check that all three environment variables are set:

- `GITHUB_APP_ID`
- `GITHUB_APP_PRIVATE_KEY`
- `GITHUB_APP_WEBHOOK_SECRET` (optional but recommended)

### "Invalid signature" on webhooks

- Verify `GITHUB_APP_WEBHOOK_SECRET` matches the secret in GitHub App settings
- Make sure the webhook URL is publicly accessible

### Installation callback fails

- Check that the callback URL in GitHub App settings matches your server URL
- Verify the `state` parameter is being passed correctly
- Check server logs for specific errors

### Private key errors

- Ensure newlines are properly escaped as `\n`
- The key should start with `-----BEGIN RSA PRIVATE KEY-----`
- Make sure quotes wrap the entire key in `.env`

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/github-app/status` | Check if GitHub App is configured |
| GET | `/api/github-app/install-url` | Get installation URL (auth required) |
| GET | `/api/github-app/callback` | Handle post-installation redirect |
| GET | `/api/github-app/installations` | List user's installations (auth required) |
| GET | `/api/github-app/installations/:id/repositories` | List accessible repos |
| DELETE | `/api/github-app/installations/:id` | Remove installation |
| POST | `/api/github-app/webhook` | GitHub webhook handler |

## Security Notes

- Never commit `.env` files with real credentials
- Use separate GitHub Apps for development and production
- Rotate private keys periodically
- The webhook secret ensures only GitHub can call your webhook endpoint
