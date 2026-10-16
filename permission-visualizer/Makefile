IMAGE_NAME ?= permission-visualizer
IMAGE_TAG  ?= latest
# The demo server is linux/amd64; without --platform an Apple-silicon build is
# pushed under an arm64 manifest that the server cannot pull.
PLATFORM   ?= linux/amd64
REGISTRY   ?= registry.macgyver.work
REGISTRY_IMAGE ?= $(REGISTRY)/keto-playground
GIT_SHA    := $(shell git rev-parse --short HEAD 2>/dev/null || echo dev)
PORT       ?= 3000
NETWORK    ?=

_NETWORK_FLAG := $(if $(NETWORK),--network $(NETWORK),)

.PHONY: dev build generate-offline docker-build docker-run docker-push seed test clean

## dev: Start the Vite dev server
dev:
	cd app && npm run dev

## build: Install deps and create the Vite production bundle
build:
	cd app && npm ci && npm run build

## generate-offline: Regenerate offline example data from examples/
generate-offline:
	node scripts/generate-offline-data.mjs

## test: Unit tests for the proxy and server (no Ory needed)
test:
	node --test test/

## seed: Seed a use case into Ory Keto (usage: make seed EXAMPLE=rbac-app-access)
seed:
	bash scripts/seed-keto.sh $(EXAMPLE)

## docker-build: Multi-stage build — compiles inside Docker, produces a distroless image
docker-build:
	docker build --platform $(PLATFORM) $(_NETWORK_FLAG) -t $(IMAGE_NAME):$(IMAGE_TAG) .

## docker-push: Build for $(PLATFORM) and push $(REGISTRY_IMAGE):<git sha> and :latest
docker-push: docker-build
	docker tag $(IMAGE_NAME):$(IMAGE_TAG) $(REGISTRY_IMAGE):$(GIT_SHA)
	docker tag $(IMAGE_NAME):$(IMAGE_TAG) $(REGISTRY_IMAGE):latest
	docker push $(REGISTRY_IMAGE):$(GIT_SHA)
	docker push $(REGISTRY_IMAGE):latest

## docker-run: Run the container (reads .env for ORY_SDK_URL and ORY_ACCESS_TOKEN)
docker-run:
	docker run --rm -p 127.0.0.1:$(PORT):3000 \
		$(_NETWORK_FLAG) \
		--env-file .env \
		$(IMAGE_NAME):$(IMAGE_TAG)

## clean: Remove build artifacts
clean:
	rm -rf app/dist app/node_modules
