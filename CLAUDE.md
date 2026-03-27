# Krateo SaaS

Multi-tenant SaaS platform built on Krateo PlatformOps. A parent Krateo instance provisions isolated child Krateo instances via vCluster.

## Repository Layout

```
charts/
  krateo-tenant/                  # Blueprint: vCluster + Krateo child (deps: vcluster 0.24.1, composition-page)
  krateo-tenant-portal/           # Blueprint page: "Deploy Krateo" card on parent portal
  krateo-tenant-composition-page/ # Composition page: tenant status, URLs, events
  krateo-saas-installer/          # Parent Krateo installer with SaaS extensions
policies/kyverno/                 # Reference Kyverno policies (also embedded in installer)
.github/workflows/
  ci.yaml                         # helm lint + schema validation on PRs
  release.yaml                    # OCI publish on version tags (v*)
```

## Conventions

- **OCI Registry**: `oci://ghcr.io/braghettos/krateo-saas`
- **Schema generation**: `krateoctl gen-schema values.yaml` — uses `# @schema` annotations
- **krateo-tenant schema post-processing**: add `additionalProperties: true` for vcluster subchart
- **Plan tiers**: free (2 CPU/4Gi), starter (4/8Gi), professional (16/32Gi), enterprise (32/64Gi)
- **Labels**: `krateo.io/tenant-name`, `krateo.io/tenant-plan`, `krateo.io/tenant: "true"`
- **Auth methods**: basic, oidc, ldap
- **Feature flags**: finops, composableportal, composableoperations

## Key Technical Details

- vCluster uses `experimental.deploy.vcluster.helm` to install Krateo inside the virtual cluster
- Tenant isolation via Kyverno-generated NetworkPolicy (ingress from same namespace + krateo-system)
- `on-clientconfig-create` Kyverno policy: Secret → namespace + Role + RoleBinding on user login
- Composition Dynamic Controller (CDC) injects `global.*` values at composition creation time
- SaaS mode gated behind `krateoplatformops.saas.enabled` in the installer

## Makefile

```
make lint        # helm lint all charts
make template    # helm template dry-run
make gen-schema  # generate values.schema.json (requires krateoctl)
make package     # package charts to dist/
make push        # package + push to OCI
make deps        # update helm dependencies
make clean       # remove dist/
```

## CI/CD

- **PRs**: ci.yaml runs `helm lint` + schema validation
- **Tags**: release.yaml publishes in dependency order: composition-page → portal → tenant → installer
- Versions extracted from git tag, injected into all Chart.yaml files
