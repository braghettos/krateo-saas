# Krateo SaaS -- Local kind Cluster Installation Plan

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Kind Cluster Configuration](#2-kind-cluster-configuration)
3. [Building and Packaging Charts](#3-building-and-packaging-charts)
4. [GitHub OAuth App Setup for Localhost](#4-github-oauth-app-setup-for-localhost)
5. [Creating Required Secrets](#5-creating-required-secrets)
6. [Installing the krateo-saas-installer Chart](#6-installing-the-krateo-saas-installer-chart)
7. [Verifying the Installation](#7-verifying-the-installation)
8. [Testing the Full Flow](#8-testing-the-full-flow)
9. [Known Limitations of kind vs Production](#9-known-limitations-of-kind-vs-production)
10. [Cleanup](#10-cleanup)

---

## 1. Prerequisites

### Required Tools

| Tool | Minimum Version | Purpose |
|------|----------------|---------|
| **Docker** | 24.x+ | Container runtime for kind nodes |
| **kind** | 0.20+ | Creates local Kubernetes cluster |
| **kubectl** | 1.28+ | Kubernetes CLI |
| **helm** | 3.14+ | Chart installation and OCI registry support |
| **krateoctl** | latest | Schema generation (only needed if building charts locally) |

### System Requirements

- **RAM**: Minimum 16 GB available to Docker. The parent Krateo installs many components (authn, snowplow, eventsse with etcd, frontend, core-provider, OPA, Kyverno, CrateDB for FinOps, multiple operators). Each vCluster tenant adds more overhead. Recommend allocating 12-16 GB to Docker Desktop.
- **CPU**: Minimum 4 cores allocated to Docker; 6+ recommended.
- **Disk**: At least 30 GB free. Container images are numerous and large.

### Verification Commands

```bash
docker version
kind version
kubectl version --client
helm version
# Optional:
krateoctl version
```

---

## 2. Kind Cluster Configuration

### Why Special Configuration Is Needed

The installer defaults to `service.type: NodePort` with `externalIpAvailable: false`. kind does not expose NodePorts to the host by default. The `extraPortMappings` maps container ports to host ports so that `localhost:<port>` reaches the cluster.

| Service | Default NodePort |
|---------|-----------------|
| frontend | 30080 |
| snowplow | 30081 |
| authn | 30082 |
| eventsse | 30083 |
| finops-database-handler | 30086 |

### Kind Cluster Config File

Save as `kind-config.yaml`:

```yaml
kind: Cluster
apiVersion: kind.x-k8s.io/v1alpha4
name: krateo-saas
nodes:
  - role: control-plane
    extraPortMappings:
      # frontend
      - containerPort: 30080
        hostPort: 30080
        protocol: TCP
      # snowplow
      - containerPort: 30081
        hostPort: 30081
        protocol: TCP
      # authn
      - containerPort: 30082
        hostPort: 30082
        protocol: TCP
      # eventsse
      - containerPort: 30083
        hostPort: 30083
        protocol: TCP
      # finops-database-handler (optional, only needed if FinOps enabled)
      - containerPort: 30086
        hostPort: 30086
        protocol: TCP
    kubeadmConfigPatches:
      - |
        kind: InitConfiguration
        nodeRegistration:
          kubeletExtraArgs:
            node-labels: "ingress-ready=true"
```

### Design Decisions

- **Single node**: Sufficient for local development. vCluster runs inside the same node as pods.
- **No ingress controller**: The installer uses NodePort mode. All services expose distinct NodePorts directly.
- **Isolated kubeconfig**: Uses a dedicated kubeconfig file (`~/.kube/krateo-kind.yaml`) via `--kubeconfig` flags. The default `~/.kube/config` is never touched, so other agents working on GKE (or any other cluster) are not affected.

### Create the Cluster

**Important**: Use `--kubeconfig` to write the kind context to a separate file, not `~/.kube/config`.

```bash
kind create cluster --config kind-config.yaml --kubeconfig ~/.kube/krateo-kind.yaml
```

### Verify

```bash
kubectl --kubeconfig ~/.kube/krateo-kind.yaml cluster-info
kubectl --kubeconfig ~/.kube/krateo-kind.yaml get nodes
```

---

## 3. Building and Packaging Charts

### Option A: Use Published OCI Registry Charts (Recommended)

Charts are published to `oci://ghcr.io/braghettos/krateo-saas`. The installer references tenant charts from this registry by default. No chart building is needed.

```bash
helm --kubeconfig ~/.kube/krateo-kind.yaml \
  install krateo-saas oci://ghcr.io/braghettos/krateo-saas/krateo-saas-installer \
  --version 0.2.0 \
  --namespace krateo-system --create-namespace \
  -f kind-values.yaml
```

### Option B: Build and Install from Local Source

```bash
# From the repository root
make deps      # pulls vcluster subchart for krateo-tenant
make lint      # validate all charts
make gen-schema  # generate schemas (requires krateoctl)

helm --kubeconfig ~/.kube/krateo-kind.yaml \
  install krateo-saas ./charts/krateo-saas-installer \
  --namespace krateo-system --create-namespace \
  -f kind-values.yaml
```

**Note**: When using local charts, `saas.tenant.chart.url` and `saas.tenant.portal.chart.url` still point to the OCI registry. The installer uses these URLs at runtime to register CompositionDefinitions. Internet access is required.

---

## 4. GitHub OAuth App Setup for Localhost

### Create the OAuth App

1. Go to **GitHub > Settings > Developer settings > OAuth Apps > New OAuth App**
2. Fill in:

| Field | Value |
|-------|-------|
| Application name | `Krateo SaaS Local` |
| Homepage URL | `http://localhost:30080` |
| Authorization callback URL | `http://localhost:30082/github/callback` |

3. Click **Register application**
4. Copy the **Client ID**
5. Click **Generate a new client secret** and copy the value

### Notes

- GitHub OAuth Apps allow `localhost` callback URLs, which is convenient for development.
- Create a separate OAuth App for local dev if you already have one for production. The callback URL must match exactly.
- The `organization` field is optional. Leave it empty to allow any GitHub user.

---

## 5. Creating Required Secrets

```bash
kubectl --kubeconfig ~/.kube/krateo-kind.yaml create namespace krateo-system

kubectl --kubeconfig ~/.kube/krateo-kind.yaml create secret generic github-oauth-secret \
  --namespace krateo-system \
  --from-literal=clientSecret=<YOUR_GITHUB_CLIENT_SECRET>
```

**Important**: Create the secret _before_ running `helm install`. The installer creates a Secret object as a step, but it only creates the metadata structure. The actual `clientSecret` data must already exist.

---

## 6. Installing the krateo-saas-installer Chart

### Values Override File

Save as `kind-values.yaml`:

```yaml
krateoplatformops:
  service:
    type: NodePort
    externalIpAvailable: false

  # Disable FinOps for local dev to save resources
  composablefinops:
    enabled: false

  saas:
    enabled: true
    github:
      clientID: "<YOUR_GITHUB_CLIENT_ID>"
      clientSecretRef:
        name: github-oauth-secret
        namespace: krateo-system
        key: clientSecret
      organization: ""
      redirectURL: "http://localhost:30082/github/callback"
    tenant:
      defaultPlan: free
      defaultKrateoVersion: "2.7.0"
      chart:
        url: oci://ghcr.io/braghettos/krateo-saas/krateo-tenant
        version: "0.2.0"
      portal:
        chart:
          url: oci://ghcr.io/braghettos/krateo-saas/krateo-tenant-portal
          version: "0.2.0"
```

### Install

```bash
helm --kubeconfig ~/.kube/krateo-kind.yaml \
  install krateo-saas oci://ghcr.io/braghettos/krateo-saas/krateo-saas-installer \
  --version 0.2.0 \
  --namespace krateo-system --create-namespace \
  -f kind-values.yaml \
  --timeout 15m
```

**Why 15-minute timeout**: The `KrateoPlatformOps` CR orchestrates many sequential chart installations, each with its own `waitTimeout: 5m`. On a local machine with cold image pulls, the entire sequence can take 10-15 minutes.

---

## 7. Verifying the Installation

All commands in this section use the `--kubeconfig` flag to target the kind cluster.

### 7.1 Helm Release

```bash
helm --kubeconfig ~/.kube/krateo-kind.yaml list -n krateo-system
```

### 7.2 KrateoPlatformOps CR Progress

```bash
kubectl --kubeconfig ~/.kube/krateo-kind.yaml get krateoplatformops -n krateo-system
kubectl --kubeconfig ~/.kube/krateo-kind.yaml describe krateoplatformops krateo -n krateo-system
```

### 7.3 All Pods

```bash
kubectl --kubeconfig ~/.kube/krateo-kind.yaml get pods -n krateo-system -w
```

Expected pods: installer, authn, snowplow, eventrouter, eventsse, eventsse-etcd, sweeper, frontend, core-provider, composition-dynamic-controller, chart-inspector, oasgen-provider, rest-dynamic-controller, opa, kyverno (multiple).

### 7.4 Kyverno Policy

```bash
kubectl --kubeconfig ~/.kube/krateo-kind.yaml get clusterpolicy tenant-namespace-on-login
kubectl --kubeconfig ~/.kube/krateo-kind.yaml describe clusterpolicy tenant-namespace-on-login
```

Verify 3 rules: `create-tenant-namespace`, `create-tenant-role`, `create-tenant-rolebinding`.

### 7.5 OAuthConfig

```bash
kubectl --kubeconfig ~/.kube/krateo-kind.yaml get oauthconfig -n krateo-system
kubectl --kubeconfig ~/.kube/krateo-kind.yaml describe oauthconfig github-oauth -n krateo-system
```

### 7.6 CompositionDefinition

```bash
kubectl --kubeconfig ~/.kube/krateo-kind.yaml get compositiondefinitions -n krateo-system
```

Should show `krateo-tenant-portal` in a ready state.

### 7.7 Service NodePorts

```bash
kubectl --kubeconfig ~/.kube/krateo-kind.yaml get svc -n krateo-system
```

Confirm NodePort assignments match expected ports (30080-30083).

### 7.8 Frontend Access

Open `http://localhost:30080` in a browser. You should see the Krateo login page with a "Login with GitHub" option.

---

## 8. Testing the Full Flow

### 8.1 GitHub Login

1. Open `http://localhost:30080`
2. Click the GitHub login button
3. Authorize the "Krateo SaaS Local" OAuth App on GitHub
4. After authorization, you are redirected back to the frontend with an authenticated session

### 8.2 Verify Auto-Provisioning

```bash
# Namespace created
kubectl --kubeconfig ~/.kube/krateo-kind.yaml get namespace <github-username>
kubectl --kubeconfig ~/.kube/krateo-kind.yaml get namespace <github-username> --show-labels

# RBAC created
kubectl --kubeconfig ~/.kube/krateo-kind.yaml get role -n <github-username>
kubectl --kubeconfig ~/.kube/krateo-kind.yaml get rolebinding -n <github-username>
```

### 8.3 Blueprint Discovery

1. Navigate to the **Blueprints** page in the portal
2. You should see a **"Deploy Krateo Instance"** card with `fa-cloud` icon

### 8.4 Submit a Tenant Request

1. Click the card to open the form
2. Fill in: tenant name (`my-test-tenant`), plan (`free`), auth method, version
3. Submit -- this creates a Composition CR in your namespace

### 8.5 Monitor Tenant Provisioning

```bash
kubectl --kubeconfig ~/.kube/krateo-kind.yaml get compositions -n <github-username>
kubectl --kubeconfig ~/.kube/krateo-kind.yaml get pods -n <github-username> -w
kubectl --kubeconfig ~/.kube/krateo-kind.yaml get statefulset -n <github-username>
```

### 8.6 Access Child Krateo (via vCluster)

The child Krateo inside vCluster uses ingresses synced to the host cluster. Without an ingress controller on kind, use `vcluster connect`:

```bash
vcluster connect <vcluster-name> -n <github-username> --kubeconfig ~/.kube/krateo-kind.yaml
kubectl --kubeconfig ~/.kube/krateo-kind.yaml port-forward svc/frontend 8080:80
# Then open http://localhost:8080
```

---

## 9. Known Limitations of kind vs Production

### Networking

| Aspect | kind (local) | Production (GKE/EKS) |
|--------|-------------|----------------------|
| Service type | NodePort with extraPortMappings | LoadBalancer with external IP |
| TLS | None (plain HTTP) | cert-manager + Let's Encrypt |
| DNS | `localhost` only | Real DNS (e.g., `app.example.com`) |
| OAuth callback | `http://localhost:30082/...` | `https://authn.example.com/...` |
| Ingress | Not configured (NodePort direct) | Ingress controller with TLS |

### Resources

- **Image pulls**: First startup is slow. Subsequent restarts reuse kind's container cache.
- **etcd storage**: eventsse etcd default PVC is 6 GB, backed by local host storage.
- **Memory pressure**: With all components + a vCluster tenant, expect 8-12 GB memory usage.
- **FinOps**: Disable `composablefinops.enabled` for local dev to save resources.

### vCluster Inside kind

- vCluster works in kind but adds a layer (Kubernetes-in-Kubernetes-in-Docker). It is slow and resource-intensive.
- Ingresses synced from vCluster require an ingress controller on the host. Without one, use `vcluster connect` + `port-forward`.
- PersistentVolumes use kind's `standard` StorageClass (rancher local-path).

### OAuth

- GitHub OAuth works with `http://localhost` but only from the machine running kind.
- Testing from another device requires using the machine's IP and updating the callback URL.

---

## 10. Cleanup

### Delete Helm Release (preserves cluster)

```bash
helm --kubeconfig ~/.kube/krateo-kind.yaml uninstall krateo-saas -n krateo-system
```

### Delete Entire kind Cluster (full cleanup)

```bash
kind delete cluster --name krateo-saas
rm -f ~/.kube/krateo-kind.yaml
```

### Delete Only Tenant Resources (keep parent running)

```bash
kubectl --kubeconfig ~/.kube/krateo-kind.yaml delete compositions --all -n <github-username>
# Wait for vCluster cleanup, then:
kubectl --kubeconfig ~/.kube/krateo-kind.yaml delete namespace <github-username>
kubectl --kubeconfig ~/.kube/krateo-kind.yaml delete secret <github-username>-clientconfig -n krateo-system
```

---

## Quick-Start Summary

```bash
# 1. Create cluster (writes to isolated kubeconfig, default context untouched)
kind create cluster --config kind-config.yaml --kubeconfig ~/.kube/krateo-kind.yaml

# 2. Create namespace + secret
kubectl --kubeconfig ~/.kube/krateo-kind.yaml create namespace krateo-system
kubectl --kubeconfig ~/.kube/krateo-kind.yaml create secret generic github-oauth-secret \
  --namespace krateo-system \
  --from-literal=clientSecret=<GITHUB_CLIENT_SECRET>

# 3. Install
helm --kubeconfig ~/.kube/krateo-kind.yaml \
  install krateo-saas oci://ghcr.io/braghettos/krateo-saas/krateo-saas-installer \
  --version 0.2.0 \
  --namespace krateo-system \
  -f kind-values.yaml \
  --timeout 15m

# 4. Wait and verify
kubectl --kubeconfig ~/.kube/krateo-kind.yaml get krateoplatformops -n krateo-system -w
kubectl --kubeconfig ~/.kube/krateo-kind.yaml get pods -n krateo-system -w

# 5. Access
open http://localhost:30080
```
