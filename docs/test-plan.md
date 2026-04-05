# Krateo SaaS -- Test Plan

Comprehensive test plan for the Krateo SaaS platform deployed on a local kind cluster.

## Overview

- **57 tests** across 10 categories
- All kubectl commands use `--kubeconfig ~/.kube/krateo-kind.yaml` to target the isolated kind cluster
- Tests are designed to run in sequence within each category
- **30 kubectl-automatable**, 12 Playwright-automatable, 7 partially automatable, 8 manual-only
- **UI tests** in `tests/ui/` use Playwright to drive a real browser through the full user journey

## Summary Table

| ID | Category | Description | Automatable |
|----|----------|-------------|-------------|
| INF-01 | Infrastructure | kind cluster node is Ready | Yes |
| INF-02 | Infrastructure | All expected pods running in krateo-system | Yes |
| INF-03 | Infrastructure | Service NodePorts accessible from localhost | Yes |
| INF-04 | Infrastructure | KrateoPlatformOps CR fully reconciled | Yes |
| INF-05 | Infrastructure | Helm release is deployed | Yes |
| AUTH-01 | Authentication | GitHub OAuth redirect initiates correctly | Partial |
| AUTH-02 | Authentication | OAuthConfig CR exists and configured | Yes |
| AUTH-03 | Authentication | GitHub OAuth full flow (browser) | Manual |
| AUTH-04 | Authentication | Login creates clientconfig Secret | Manual |
| AUTH-05 | Authentication | Unauthorized API access is rejected | Yes |
| AUTH-06 | Authentication | RESTAction for GitHub user info exists | Yes |
| KYV-01 | Kyverno | Namespace created on clientconfig Secret | Yes |
| KYV-02 | Kyverno | Role created with correct permissions | Yes |
| KYV-03 | Kyverno | RoleBinding created linking user to Role | Yes |
| KYV-04 | Kyverno | synchronize=true recreates deleted resources | Yes |
| KYV-05 | Kyverno | Multiple users get separate namespaces | Yes |
| KYV-06 | Kyverno | ResourceQuota policy applies to tenant NS | Yes |
| KYV-07 | Kyverno | NetworkPolicy created for tenant isolation | Yes |
| BP-01 | Blueprint | CompositionDefinition exists and ready | Yes |
| BP-02 | Blueprint | Panel widget exists on Blueprints page | Yes |
| BP-03 | Blueprint | Form widget exists with correct schema fields | Yes |
| BP-04 | Blueprint | Namespace dropdown filters by RBAC | Manual |
| BP-05 | Blueprint | Blueprint panel visible in browser | Manual |
| PROV-01 | Provisioning | Form submission creates Composition CR | Manual |
| PROV-02 | Provisioning | CDC starts reconciliation | Yes |
| PROV-03 | Provisioning | vCluster StatefulSet is created | Yes |
| PROV-04 | Provisioning | ResourceQuota matches selected plan tier | Yes |
| PROV-05 | Provisioning | tenant-info ConfigMap created | Yes |
| PROV-06 | Provisioning | Krateo installs inside vCluster | Yes |
| COMP-01 | Composition Mgmt | Status flowchart renders | Manual |
| COMP-02 | Composition Mgmt | Events tab populated | Manual |
| COMP-03 | Composition Mgmt | Values tab shows config | Manual |
| COMP-04 | Composition Mgmt | Pause sets annotation | Yes |
| COMP-05 | Composition Mgmt | Unpause clears annotation | Yes |
| COMP-06 | Composition Mgmt | Delete cleans up vCluster | Yes |
| PLAN-01 | Plan Tiers | free: 2 CPU / 4Gi / 20 pods | Yes |
| PLAN-02 | Plan Tiers | starter: 4 CPU / 8Gi / 50 pods | Yes |
| PLAN-03 | Plan Tiers | professional: 16 CPU / 32Gi / 100 pods | Yes |
| PLAN-04 | Plan Tiers | enterprise: 32 CPU / 64Gi / 200 pods | Yes |
| NEG-01 | Negative | Invalid tenant name rejected | Yes |
| NEG-02 | Negative | Cross-namespace access denied | Yes |
| NEG-03 | Negative | Admin resource access denied | Yes |
| NEG-04 | Negative | Graceful vCluster failure handling | Yes |
| E2E-01 | Smoke Test | Full happy path end-to-end | Manual |
| UI-01 | UI (Playwright) | Frontend reachable, login page renders | Yes |
| UI-02 | UI (Playwright) | GitHub OAuth flow completes in browser | Yes* |
| UI-03 | UI (Playwright) | Portal home renders after login | Yes |
| UI-04 | UI (Playwright) | Blueprints page is navigable | Yes |
| UI-05 | UI (Playwright) | "Deploy Krateo Instance" card visible | Yes |
| UI-06 | UI (Playwright) | Clicking card opens form drawer | Yes |
| UI-07 | UI (Playwright) | Form has tenantName, plan, namespace fields | Yes |
| UI-08 | UI (Playwright) | Namespace dropdown excludes system namespaces | Yes |
| UI-09 | UI (Playwright) | Submit form creates Composition CR | Yes |
| UI-10 | UI (Playwright) | Composition page shows Status/Values/Events tabs | Yes |
| UI-11 | UI (Playwright) | Cluster resources verified post-provisioning | Yes |
| UI-12 | UI (Playwright) | Delete composition via UI and verify cleanup | Yes |

\* UI-02 requires `GITHUB_USER` and `GITHUB_PASSWORD` env vars (and optionally `GITHUB_TOTP_SECRET` for 2FA).

---

## 1. Infrastructure Tests

### INF-01: kind cluster node is Ready

- **Prerequisites**: kind cluster created with `kind create cluster --config kind-config.yaml --kubeconfig ~/.kube/krateo-kind.yaml`
- **Steps**:
  ```bash
  kubectl --kubeconfig ~/.kube/krateo-kind.yaml get nodes
  ```
- **Expected**: Single node `krateo-saas-control-plane` in `Ready` status
- **Pass/Fail**: Node status is `Ready`

### INF-02: All expected pods running in krateo-system

- **Prerequisites**: INF-01, Helm install completed
- **Steps**:
  ```bash
  kubectl --kubeconfig ~/.kube/krateo-kind.yaml get pods -n krateo-system --no-headers | awk '{print $1, $3}'
  ```
- **Expected**: All pods `Running` or `Completed`: installer, authn, snowplow, eventrouter, eventsse, eventsse-etcd, sweeper, frontend, core-provider, composition-dynamic-controller, chart-inspector, oasgen-provider, rest-dynamic-controller, opa, kyverno (admission, background, cleanup, reports)
- **Pass/Fail**: Zero pods in `CrashLoopBackOff`, `Error`, or `Pending` for >5 minutes

### INF-03: Service NodePorts accessible from localhost

- **Prerequisites**: INF-02
- **Steps**:
  ```bash
  curl -s -o /dev/null -w "%{http_code}" http://localhost:30080  # frontend
  curl -s -o /dev/null -w "%{http_code}" http://localhost:30082/healthz  # authn
  curl -s -o /dev/null -w "%{http_code}" http://localhost:30081  # snowplow
  curl -s -o /dev/null -w "%{http_code}" http://localhost:30083  # eventsse
  ```
- **Expected**: HTTP 200 (or 302 for frontend redirect) from each port
- **Pass/Fail**: All four ports respond (non-connection-refused)

### INF-04: KrateoPlatformOps CR fully reconciled

- **Prerequisites**: INF-02
- **Steps**:
  ```bash
  kubectl --kubeconfig ~/.kube/krateo-kind.yaml get krateoplatformops krateo -n krateo-system \
    -o jsonpath='{.status.conditions[?(@.type=="Ready")].status}'
  ```
- **Expected**: `True`
- **Pass/Fail**: Ready condition is `True`

### INF-05: Helm release is deployed

- **Prerequisites**: Helm install completed
- **Steps**:
  ```bash
  helm --kubeconfig ~/.kube/krateo-kind.yaml list -n krateo-system
  ```
- **Expected**: `krateo-saas` release in `deployed` status
- **Pass/Fail**: Status column shows `deployed`

---

## 2. Authentication Tests

### AUTH-01: GitHub OAuth redirect initiates correctly

- **Prerequisites**: INF-03
- **Steps**:
  ```bash
  curl -s -o /dev/null -w "%{http_code} %{redirect_url}" http://localhost:30082/github/authorize
  ```
- **Expected**: HTTP 302 redirect to `https://github.com/login/oauth/authorize?client_id=<configured_id>&...`
- **Pass/Fail**: Redirect URL contains `github.com/login/oauth/authorize` with correct client_id

### AUTH-02: OAuthConfig CR exists and is correctly configured

- **Prerequisites**: INF-04
- **Steps**:
  ```bash
  kubectl --kubeconfig ~/.kube/krateo-kind.yaml get oauthconfig github-oauth -n krateo-system -o yaml
  ```
- **Expected**: `spec.clientID` matches configured value, `spec.redirectURL` = `http://localhost:30082/github/callback`, `spec.scopes` includes `read:user` and `read:org`
- **Pass/Fail**: All field values match kind-values.yaml

### AUTH-03: GitHub OAuth full flow (browser) -- MANUAL

- **Prerequisites**: AUTH-02, valid GitHub OAuth App
- **Steps**:
  1. Open `http://localhost:30080`
  2. Click "Login with GitHub"
  3. Authorize the OAuth App on GitHub
  4. Observe redirect back to frontend
- **Expected**: User is logged in, frontend shows authenticated UI with user avatar
- **Pass/Fail**: Frontend displays user identity post-login

### AUTH-04: Login creates clientconfig Secret -- MANUAL

- **Prerequisites**: AUTH-03
- **Steps**:
  ```bash
  kubectl --kubeconfig ~/.kube/krateo-kind.yaml get secret -n krateo-system | grep clientconfig
  ```
- **Expected**: Secret `<github-username>-clientconfig` exists in `krateo-system`
- **Pass/Fail**: Secret exists

### AUTH-05: Unauthorized API access is rejected

- **Prerequisites**: INF-03
- **Steps**:
  ```bash
  curl -s -w "%{http_code}" http://localhost:30081/apis/composition.krateo.io/v1alpha1
  ```
- **Expected**: HTTP 401 or 403
- **Pass/Fail**: Response is not 200

### AUTH-06: RESTAction for GitHub user info exists

- **Prerequisites**: INF-04
- **Steps**:
  ```bash
  kubectl --kubeconfig ~/.kube/krateo-kind.yaml get restaction github-oauth-restaction -n krateo-system \
    -o jsonpath='{.spec.api[0].path}'
  ```
- **Expected**: `/user` (GitHub user info endpoint)
- **Pass/Fail**: RESTAction exists with correct API path

---

## 3. Kyverno Auto-Provisioning Tests

> **Note**: These tests simulate login by creating a `*-clientconfig` Secret directly, which triggers the same Kyverno policy path as a real GitHub login.

### KYV-01: Namespace created on clientconfig Secret creation

- **Prerequisites**: INF-04, Kyverno pods running
- **Steps**:
  ```bash
  kubectl --kubeconfig ~/.kube/krateo-kind.yaml create secret generic testuser-clientconfig \
    --namespace krateo-system --from-literal=kubeconfig=fake
  sleep 10
  kubectl --kubeconfig ~/.kube/krateo-kind.yaml get namespace testuser --show-labels
  ```
- **Expected**: Namespace `testuser` with labels `krateo.io/tenant=true` and `krateo.io/tenant-user=testuser`
- **Pass/Fail**: Namespace exists with both labels

### KYV-02: Role created with correct permissions

- **Prerequisites**: KYV-01
- **Steps**:
  ```bash
  kubectl --kubeconfig ~/.kube/krateo-kind.yaml get role tenant-composition-role -n testuser -o yaml
  ```
- **Expected**: Two rules: (1) `composition.krateo.io/*` with verbs `create,get,list,watch,delete,update,patch`; (2) `templates.krateo.io/*` with verbs `get,list,watch`
- **Pass/Fail**: Both rules present with exact verb sets

### KYV-03: RoleBinding created linking user to Role

- **Prerequisites**: KYV-01
- **Steps**:
  ```bash
  kubectl --kubeconfig ~/.kube/krateo-kind.yaml get rolebinding tenant-composition-rolebinding -n testuser -o yaml
  ```
- **Expected**: References `tenant-composition-role`, binds subject `User:testuser`
- **Pass/Fail**: roleRef and subject match

### KYV-04: synchronize=true recreates deleted resources

- **Prerequisites**: KYV-03
- **Steps**:
  ```bash
  kubectl --kubeconfig ~/.kube/krateo-kind.yaml delete role tenant-composition-role -n testuser
  sleep 15
  kubectl --kubeconfig ~/.kube/krateo-kind.yaml get role tenant-composition-role -n testuser
  ```
- **Expected**: Role recreated by Kyverno
- **Pass/Fail**: Role exists again after deletion

### KYV-05: Multiple users get separate namespaces

- **Prerequisites**: KYV-01
- **Steps**:
  ```bash
  kubectl --kubeconfig ~/.kube/krateo-kind.yaml create secret generic seconduser-clientconfig \
    --namespace krateo-system --from-literal=kubeconfig=fake
  sleep 10
  kubectl --kubeconfig ~/.kube/krateo-kind.yaml get namespace seconduser --show-labels
  kubectl --kubeconfig ~/.kube/krateo-kind.yaml get role tenant-composition-role -n seconduser
  kubectl --kubeconfig ~/.kube/krateo-kind.yaml get rolebinding tenant-composition-rolebinding -n seconduser
  ```
- **Expected**: Namespace `seconduser` with labels, own Role and RoleBinding
- **Pass/Fail**: All three resources exist independently from `testuser`

### KYV-06: ResourceQuota policy applies to tenant namespace

- **Prerequisites**: KYV-01, `tenant-resource-quota` ClusterPolicy deployed
- **Steps**:
  ```bash
  kubectl --kubeconfig ~/.kube/krateo-kind.yaml get resourcequota tenant-quota -n testuser -o yaml
  ```
- **Expected**: `requests.cpu=4`, `requests.memory=8Gi`, `pods=50`, `persistentvolumeclaims=10`
- **Pass/Fail**: All quota values match

### KYV-07: NetworkPolicy created for tenant isolation

- **Prerequisites**: KYV-01
- **Steps**:
  ```bash
  kubectl --kubeconfig ~/.kube/krateo-kind.yaml get networkpolicy tenant-isolation -n testuser -o yaml
  ```
- **Expected**: Ingress only from same namespace and `krateo-system`, all egress allowed
- **Pass/Fail**: Rules match expected namespace selectors

---

## 4. Blueprint and Portal Tests

### BP-01: CompositionDefinition exists and is ready

- **Prerequisites**: INF-04
- **Steps**:
  ```bash
  kubectl --kubeconfig ~/.kube/krateo-kind.yaml get compositiondefinitions krateo-tenant-portal \
    -n krateo-system -o jsonpath='{.status.conditions[?(@.type=="Ready")].status}'
  ```
- **Expected**: `True`
- **Pass/Fail**: CompositionDefinition is Ready

### BP-02: Panel widget exists on Blueprints page

- **Prerequisites**: BP-01
- **Steps**:
  ```bash
  kubectl --kubeconfig ~/.kube/krateo-kind.yaml get panels -n krateo-system \
    -l krateo.io/portal-page=blueprints
  ```
- **Expected**: Panel with title "Deploy Krateo Instance" and icon `fa-cloud`
- **Pass/Fail**: Panel with `krateo.io/portal-page=blueprints` label found

### BP-03: Form widget exists with correct schema fields

- **Prerequisites**: BP-01
- **Steps**:
  ```bash
  kubectl --kubeconfig ~/.kube/krateo-kind.yaml get forms -n krateo-system -o yaml
  ```
- **Expected**: Form references CompositionDefinition schema with fields: `tenantName` (string), `plan` (enum), `authMethod` (enum), `krateoVersion` (string), `features` (object)
- **Pass/Fail**: Form CR exists and references correct RESTAction

### BP-04: Namespace dropdown filters by RBAC -- MANUAL

- **Prerequisites**: AUTH-03, KYV-01
- **Steps**:
  1. Log in, navigate to Blueprints, click "Deploy Krateo Instance"
  2. Observe the namespace dropdown
- **Expected**: Only user's own namespace shown, not `krateo-system` or other users' namespaces
- **Pass/Fail**: Only RBAC-permitted namespaces listed

### BP-05: Blueprint panel visible in browser -- MANUAL

- **Prerequisites**: AUTH-03
- **Steps**:
  1. Log in, navigate to Blueprints page
  2. Look for "Deploy Krateo Instance" card
- **Expected**: Card visible with `fa-cloud` icon and Ready indicator
- **Pass/Fail**: Card renders with title and icon

---

## 5. Tenant Provisioning Tests

### PROV-01: Form submission creates Composition CR -- MANUAL

- **Prerequisites**: BP-04
- **Steps**:
  1. Fill in form: tenantName=`my-test-tenant`, plan=`free`, authMethod=`basic`
  2. Submit
  3. Verify:
     ```bash
     kubectl --kubeconfig ~/.kube/krateo-kind.yaml get compositions -n <github-username>
     ```
- **Expected**: Composition CR exists in user namespace
- **Pass/Fail**: CR exists

### PROV-02: CDC starts reconciliation

- **Prerequisites**: PROV-01
- **Steps**:
  ```bash
  kubectl --kubeconfig ~/.kube/krateo-kind.yaml get compositions -n <namespace> \
    -o jsonpath='{.items[0].status}'
  ```
- **Expected**: Status shows reconciliation in progress
- **Pass/Fail**: Status contains conditions

### PROV-03: vCluster StatefulSet is created

- **Prerequisites**: PROV-02
- **Steps**:
  ```bash
  kubectl --kubeconfig ~/.kube/krateo-kind.yaml get statefulset -n <namespace>
  kubectl --kubeconfig ~/.kube/krateo-kind.yaml get pods -n <namespace> -l app=vcluster
  ```
- **Expected**: StatefulSet exists, pod running
- **Pass/Fail**: StatefulSet has 1 ready replica

### PROV-04: ResourceQuota matches selected plan tier

- **Prerequisites**: PROV-01
- **Steps**:
  ```bash
  kubectl --kubeconfig ~/.kube/krateo-kind.yaml get resourcequota -n <namespace> -o yaml
  ```
- **Expected**: For `free` plan: `requests.cpu=2`, `requests.memory=4Gi`, `pods=20`
- **Pass/Fail**: Values match selected tier

### PROV-05: tenant-info ConfigMap created

- **Prerequisites**: PROV-02
- **Steps**:
  ```bash
  kubectl --kubeconfig ~/.kube/krateo-kind.yaml get configmap my-test-tenant-info -n <namespace> -o yaml
  ```
- **Expected**: Data fields: `tenantName=my-test-tenant`, `plan=free`, `authMethod=basic`, `krateoVersion=2.7.0`, features
- **Pass/Fail**: All fields present with expected values

### PROV-06: Krateo installs inside vCluster

- **Prerequisites**: PROV-03, wait up to 10 minutes
- **Steps**:
  ```bash
  vcluster connect <vcluster-name> -n <namespace> --kubeconfig ~/.kube/krateo-kind.yaml
  kubectl get pods -n krateo-system
  ```
- **Expected**: authn, frontend, core-provider pods running inside vCluster
- **Pass/Fail**: At least 3 core pods in Running state

---

## 6. Composition Management Tests

### COMP-01: Status flowchart renders -- MANUAL

- **Prerequisites**: PROV-03
- **Steps**: Navigate to composition page, observe Status tab
- **Expected**: FlowChart widget shows resource tree
- **Pass/Fail**: Flowchart displays nodes

### COMP-02: Events tab populated -- MANUAL

- **Prerequisites**: PROV-03
- **Steps**: Click Events tab on composition page
- **Expected**: EventList shows Kubernetes events
- **Pass/Fail**: At least one event visible

### COMP-03: Values tab shows configuration -- MANUAL

- **Prerequisites**: PROV-03
- **Steps**: Click Values tab on composition page
- **Expected**: YAML viewer shows current spec values
- **Pass/Fail**: Values tab renders readable YAML

### COMP-04: Pause sets annotation

- **Prerequisites**: PROV-02
- **Steps**:
  ```bash
  kubectl --kubeconfig ~/.kube/krateo-kind.yaml patch compositions.composition.krateo.io <name> \
    -n <namespace> --type merge -p '{"metadata":{"annotations":{"krateo.io/paused":"true"}}}'
  kubectl --kubeconfig ~/.kube/krateo-kind.yaml get compositions.composition.krateo.io <name> \
    -n <namespace> -o jsonpath='{.metadata.annotations.krateo\.io/paused}'
  ```
- **Expected**: Annotation `krateo.io/paused=true`
- **Pass/Fail**: Value is `true`

### COMP-05: Unpause clears annotation

- **Prerequisites**: COMP-04
- **Steps**:
  ```bash
  kubectl --kubeconfig ~/.kube/krateo-kind.yaml patch compositions.composition.krateo.io <name> \
    -n <namespace> --type merge -p '{"metadata":{"annotations":{"krateo.io/paused":"false"}}}'
  ```
- **Expected**: Annotation cleared, CDC resumes
- **Pass/Fail**: Value is `false`

### COMP-06: Delete cleans up vCluster

- **Prerequisites**: PROV-03
- **Steps**:
  ```bash
  kubectl --kubeconfig ~/.kube/krateo-kind.yaml delete compositions.composition.krateo.io <name> -n <namespace>
  sleep 30
  kubectl --kubeconfig ~/.kube/krateo-kind.yaml get statefulset -n <namespace>
  kubectl --kubeconfig ~/.kube/krateo-kind.yaml get pods -n <namespace>
  ```
- **Expected**: Composition deleted, vCluster StatefulSet removed, no orphan pods
- **Pass/Fail**: No StatefulSet or vCluster pods remain

---

## 7. Plan Tier Tests

These tests validate ResourceQuota values via `helm template` without needing a running cluster.

### PLAN-01: free plan quota

```bash
helm template test oci://ghcr.io/braghettos/krateo-saas/krateo-tenant \
  --version 0.2.0 --set plan=free --set tenantName=test | grep -A10 ResourceQuota
```

**Expected**: `requests.cpu: "2"`, `requests.memory: 4Gi`, `pods: "20"`

### PLAN-02: starter plan quota

```bash
helm template test oci://ghcr.io/braghettos/krateo-saas/krateo-tenant \
  --version 0.2.0 --set plan=starter --set tenantName=test | grep -A10 ResourceQuota
```

**Expected**: `requests.cpu: "4"`, `requests.memory: 8Gi`, `pods: "50"`

### PLAN-03: professional plan quota

```bash
helm template test oci://ghcr.io/braghettos/krateo-saas/krateo-tenant \
  --version 0.2.0 --set plan=professional --set tenantName=test | grep -A10 ResourceQuota
```

**Expected**: `requests.cpu: "16"`, `requests.memory: 32Gi`, `pods: "100"`

### PLAN-04: enterprise plan quota

```bash
helm template test oci://ghcr.io/braghettos/krateo-saas/krateo-tenant \
  --version 0.2.0 --set plan=enterprise --set tenantName=test | grep -A10 ResourceQuota
```

**Expected**: `requests.cpu: "32"`, `requests.memory: 64Gi`, `pods: "200"`

---

## 8. Negative Tests

### NEG-01: Invalid tenant name rejected

```bash
kubectl --kubeconfig ~/.kube/krateo-kind.yaml apply -f - <<EOF
apiVersion: composition.krateo.io/v0-2-0
kind: KrateoTenant
metadata:
  name: bad-tenant
  namespace: testuser
spec:
  tenantName: ""
  plan: free
  authMethod: basic
  krateoVersion: "2.7.0"
  features:
    finops: false
    composableportal: true
    composableoperations: true
EOF
```

**Expected**: Rejected by CRD validation

### NEG-02: Cross-namespace access denied

```bash
kubectl --kubeconfig ~/.kube/krateo-kind.yaml auth can-i create compositions.composition.krateo.io \
  -n seconduser --as=testuser
```

**Expected**: `no`

### NEG-03: Admin resource access denied

```bash
kubectl --kubeconfig ~/.kube/krateo-kind.yaml auth can-i get secrets -n krateo-system --as=testuser
kubectl --kubeconfig ~/.kube/krateo-kind.yaml auth can-i delete namespaces --as=testuser
kubectl --kubeconfig ~/.kube/krateo-kind.yaml auth can-i get clusterroles --as=testuser
```

**Expected**: All three return `no`

### NEG-04: Graceful vCluster failure handling

```bash
kubectl --kubeconfig ~/.kube/krateo-kind.yaml get compositions.composition.krateo.io <name> \
  -n <namespace> -o jsonpath='{.status.conditions}'
```

**Expected**: Composition status reports failure condition (not stuck silently)

---

## 9. Smoke Test (End-to-End) -- MANUAL

### E2E-01: Full happy path

1. Open `http://localhost:30080`
2. Click "Login with GitHub", authorize
3. Verify namespace created:
   ```bash
   kubectl --kubeconfig ~/.kube/krateo-kind.yaml get namespace <github-username>
   ```
4. Navigate to Blueprints, click "Deploy Krateo Instance"
5. Fill in: tenantName=`e2e-test`, plan=`free`, submit
6. Wait for provisioning (up to 10 minutes):
   ```bash
   kubectl --kubeconfig ~/.kube/krateo-kind.yaml get compositions -n <github-username> -w
   kubectl --kubeconfig ~/.kube/krateo-kind.yaml get statefulset -n <github-username> -w
   ```
7. Verify vCluster running:
   ```bash
   kubectl --kubeconfig ~/.kube/krateo-kind.yaml get pods -n <github-username> -l app=vcluster
   ```
8. Verify tenant-info:
   ```bash
   kubectl --kubeconfig ~/.kube/krateo-kind.yaml get configmap e2e-test-info -n <github-username>
   ```
9. Delete composition from portal or kubectl
10. Verify cleanup -- no vCluster pods remain

**Estimated duration**: 15-20 minutes

---

## 10. UI Tests (Playwright)

These tests use Playwright to drive a real Chromium browser through the full SaaS user journey. They cover what was previously manual-only: OAuth login, portal navigation, blueprint discovery, form interaction, tenant provisioning, and cleanup.

### Setup

```bash
cd tests/ui
npm install
npx playwright install chromium
```

### Running

```bash
# Full suite (requires GitHub credentials)
GITHUB_USER=<user> GITHUB_PASSWORD=<pass> npm test

# Headed mode (watch the browser)
GITHUB_USER=<user> GITHUB_PASSWORD=<pass> npm run test:headed

# Debug mode (step through)
GITHUB_USER=<user> GITHUB_PASSWORD=<pass> npm run test:debug

# Custom frontend URL / kubeconfig
KRATEO_FRONTEND_URL=http://localhost:30080 KUBECONFIG=~/.kube/krateo-kind.yaml npm test
```

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `GITHUB_USER` | Yes | GitHub username for OAuth login |
| `GITHUB_PASSWORD` | Yes | GitHub password |
| `GITHUB_TOTP_SECRET` | If 2FA | TOTP seed for GitHub 2FA |
| `KRATEO_FRONTEND_URL` | No | Frontend URL (default: `http://localhost:30080`) |
| `KUBECONFIG` | No | Kubeconfig path (default: `~/.kube/krateo-kind.yaml`) |
| `TENANT_NAME` | No | Tenant name for provisioning test (default: `ui-test-tenant`) |
| `TENANT_PLAN` | No | Plan tier to select (default: `free`) |

### Test Projects (sequential)

The tests run in 3 ordered projects, with auth state shared via `storageState`:

1. **`login`** (`01-login.spec.ts`) — GitHub OAuth flow, saves session
2. **`portal`** (`02-portal.spec.ts`) — Portal navigation, blueprint discovery, form fields
3. **`tenant`** (`03-tenant.spec.ts`) — Tenant provisioning, composition page, delete + cleanup

### Individual Tests

| ID | Spec | Test | What it does |
|----|------|------|-------------|
| UI-01 | 01-login | Frontend reachable | Navigates to `/`, verifies login page with GitHub button |
| UI-02 | 01-login | OAuth flow | Clicks GitHub login, fills credentials on github.com, handles 2FA/authorize, verifies redirect back to authenticated portal |
| UI-03 | 02-portal | Portal home | Verifies login button is gone (authenticated state) |
| UI-04 | 02-portal | Blueprints navigable | Clicks Blueprints nav link or navigates to `/blueprints` |
| UI-05 | 02-portal | Blueprint card visible | Finds "Deploy Krateo Instance" card on Blueprints page |
| UI-06 | 02-portal | Form drawer opens | Clicks card, verifies drawer/modal with form appears |
| UI-07 | 02-portal | Form fields present | Checks `tenantName` input, `plan` dropdown, `namespace` dropdown |
| UI-08 | 02-portal | RBAC namespace filter | Opens namespace dropdown, asserts `krateo-system`/`kube-system` are absent |
| UI-09 | 03-tenant | Submit creates CR | Fills form, submits, verifies Composition CR via `kubectl` |
| UI-10 | 03-tenant | Composition page tabs | Navigates to composition detail, checks Status/Values/Events tabs |
| UI-11 | 03-tenant | Cluster resources | Verifies ResourceQuota, tenant-info ConfigMap, vCluster StatefulSet via `kubectl` |
| UI-12 | 03-tenant | Delete + cleanup | Clicks delete button on composition page, confirms, verifies CR removed via `kubectl` |

### Artifacts on Failure

Playwright captures screenshots, video, and trace on failure in `tests/ui/test-results/`. View traces with:

```bash
npx playwright show-trace tests/ui/test-results/<test>/trace.zip
```

---

## Test Cleanup

```bash
# Remove simulated test users (from Kyverno tests)
kubectl --kubeconfig ~/.kube/krateo-kind.yaml delete secret testuser-clientconfig -n krateo-system
kubectl --kubeconfig ~/.kube/krateo-kind.yaml delete secret seconduser-clientconfig -n krateo-system
kubectl --kubeconfig ~/.kube/krateo-kind.yaml delete namespace testuser
kubectl --kubeconfig ~/.kube/krateo-kind.yaml delete namespace seconduser

# Remove UI test tenant (if not cleaned up by UI-12)
kubectl --kubeconfig ~/.kube/krateo-kind.yaml delete compositions --all -A
```

## Automation Notes

- **kubectl-automatable (30 tests)**: Infrastructure, Kyverno, Plan Tier, and Negative tests can run in CI via kubectl/helm.
- **Playwright-automatable (12 tests)**: UI tests in `tests/ui/` drive a real browser through login, navigation, form submission, and deletion. Require GitHub credentials as env vars.
- **Partially automatable (7 tests)**: Provisioning and Composition Management tests can be automated by creating Composition CRs via `kubectl apply` (bypassing the UI form).
- **Manual only (1 test)**: E2E-01 is the full human walkthrough (superseded by Playwright UI tests for CI).
