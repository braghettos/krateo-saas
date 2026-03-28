# SaaS User Flow

This document describes the end-to-end flow for Krateo SaaS — from platform setup to tenant self-service.

## Prerequisites

### 1. GitHub OAuth App

Create a GitHub OAuth App to enable user authentication:

1. Go to **GitHub > Settings > Developer settings > OAuth Apps > New OAuth App**
2. Fill in the fields:
   - **Application name**: `Krateo SaaS` (or any descriptive name)
   - **Homepage URL**: Your Krateo frontend URL (e.g. `https://app.example.com`)
   - **Authorization callback URL**: Your authn service callback URL (e.g. `https://authn.example.com/github/callback`)
3. Click **Register application**
4. Copy the **Client ID** and generate a **Client Secret**

### 2. Kubernetes Secret

Store the OAuth client secret in your cluster:

```bash
kubectl create secret generic github-oauth-secret \
  --namespace krateo-system \
  --from-literal=clientSecret=<YOUR_GITHUB_CLIENT_SECRET>
```

## Enabling SaaS Mode

In your `values.yaml` for `krateo-saas-installer`, set:

```yaml
krateoplatformops:
  saas:
    enabled: true
    github:
      clientID: "<YOUR_GITHUB_CLIENT_ID>"
      clientSecretRef:
        name: github-oauth-secret
        namespace: krateo-system
        key: clientSecret
      organization: "your-org"          # optional: restrict to org members
      redirectURL: "https://authn.example.com/github/callback"
```

When `saas.enabled` is `true`, the installer will:
1. Install **Kyverno** (cluster policy engine)
2. Configure a **GitHub OAuth** strategy in authn
3. Create a **Kyverno ClusterPolicy** that auto-provisions tenant resources on login
4. Register the **krateo-tenant-portal** CompositionDefinition and Composition

## User Login Flow (GitHub OAuth)

1. User navigates to the Krateo frontend
2. Frontend redirects to authn, which redirects to GitHub for OAuth authorization
3. User authenticates with GitHub and authorizes the Krateo OAuth App
4. GitHub redirects back to the authn callback URL with an authorization code
5. Authn exchanges the code for a GitHub token, extracts the username
6. Authn generates a kubeconfig and stores it as a `<username>-clientconfig` Secret in `krateo-system`

## Auto-Provisioning (Namespace + RBAC)

When the `<username>-clientconfig` Secret is created, the Kyverno ClusterPolicy triggers and generates:

| Resource | Name | Namespace | Purpose |
|----------|------|-----------|---------|
| **Namespace** | `<username>` | — | Isolated tenant namespace |
| **Role** | `tenant-composition-role` | `<username>` | Grants CRUD on `composition.krateo.io/*` and read on `templates.krateo.io/*` |
| **RoleBinding** | `tenant-composition-rolebinding` | `<username>` | Binds the user to the Role |

This means each user gets their own namespace with the exact permissions needed to discover blueprints and manage their own Compositions — no manual admin intervention required.

## Blueprint Discovery and Tenant Request Form

Once logged in:

1. The **krateo-tenant-portal** Composition provides a portal page listing available blueprints
2. The user sees a **"Deploy Krateo Instance"** card (configured with `fa-cloud` icon)
3. Clicking the card opens a form with fields derived from the **krateo-tenant** CompositionDefinition schema:
   - **Tenant name**: identifier for the Krateo instance
   - **Plan**: the tier to deploy (defaults to `free`)
   - **Krateo version**: the version to deploy (defaults to `2.7.0`)
4. Submitting the form creates a **Composition** CR in the user's namespace

## Composition Management

After submitting a tenant request:

- **Status**: The Composition status is visible in the portal — showing provisioning progress, readiness, and any errors
- **Pause**: Users can pause their Krateo instance (stops reconciliation without deleting resources)
- **Delete**: Users can delete their Composition, which tears down the child Krateo instance

The `composition-dynamic-controller` reconciles each Composition, deploying the child Krateo Helm release into the tenant namespace.

## Plan Tiers and Resource Limits

Plans are defined in the **krateo-tenant** chart and control what resources a tenant gets:

| Plan | Description | Typical Limits |
|------|-------------|----------------|
| **free** | Trial / evaluation tier | Limited CPU/memory, single replica, no FinOps |
| **starter** | Small team usage | Moderate resources, basic components |
| **enterprise** | Full-featured deployment | Higher limits, all components enabled (FinOps, OPA, etc.) |

Plan enforcement:
- The `defaultPlan` in `values.yaml` determines what new tenants get (`free` by default)
- Each plan maps to a set of Helm values in the krateo-tenant chart controlling which components are enabled and their resource requests/limits
- Upgrading a plan means updating the Composition's plan field, which triggers re-reconciliation with the new values
