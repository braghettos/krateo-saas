CHARTS := krateo-tenant krateo-tenant-portal krateo-tenant-composition-page krateo-saas-installer
REGISTRY := ghcr.io/braghettos/krateo-saas

.PHONY: lint template gen-schema package push clean

# Lint all charts
lint:
	@for chart in $(CHARTS); do \
		echo "Linting $$chart..."; \
		helm lint charts/$$chart || exit 1; \
	done

# Template all charts (dry-run)
template:
	@for chart in $(CHARTS); do \
		echo "Templating $$chart..."; \
		helm template test charts/$$chart > /dev/null || exit 1; \
	done

# Generate values.schema.json for blueprint charts
gen-schema:
	@for chart in krateo-tenant-portal krateo-tenant-composition-page; do \
		echo "Generating schema for $$chart..."; \
		krateoctl gen-schema charts/$$chart/values.yaml; \
	done
	@echo "Generating schema for krateo-tenant (with post-processing)..."
	@krateoctl gen-schema charts/krateo-tenant/values.yaml
	@python3 -c "\
	import json; \
	f = open('charts/krateo-tenant/values.schema.json', 'r'); schema = json.load(f); f.close(); \
	schema['additionalProperties'] = True; \
	schema['properties']['vcluster'] = {'additionalProperties': True, 'description': 'vCluster subchart configuration', 'title': 'vcluster', 'type': 'object'}; \
	schema['properties'].get('global', {})['additionalProperties'] = True if 'global' in schema['properties'] else None; \
	schema['required'] = [r for r in schema.get('required', []) if r != 'vcluster']; \
	f = open('charts/krateo-tenant/values.schema.json', 'w'); json.dump(schema, f, indent=2); f.write('\n'); f.close()"

# Package all charts
package:
	@mkdir -p dist
	@for chart in $(CHARTS); do \
		echo "Packaging $$chart..."; \
		helm package charts/$$chart -d dist/; \
	done

# Push charts to OCI registry
push: package
	@for chart in $(CHARTS); do \
		echo "Pushing $$chart..."; \
		helm push dist/$$chart-*.tgz oci://$(REGISTRY); \
	done

# Update dependencies
deps:
	@for chart in $(CHARTS); do \
		echo "Updating deps for $$chart..."; \
		helm dependency update charts/$$chart 2>/dev/null || true; \
	done

clean:
	rm -rf dist/
	@for chart in $(CHARTS); do \
		rm -rf charts/$$chart/charts/; \
	done
