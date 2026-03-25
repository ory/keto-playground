IMAGE_NAME ?= permission-visualizer
IMAGE_TAG  ?= latest
PORT       ?= 3000
NETWORK    ?=

_NETWORK_FLAG := $(if $(NETWORK),--network $(NETWORK),)

.PHONY: dev build generate-offline docker-build docker-run seed clean

## dev: Start the Vite dev server
dev:
	cd app && npm run dev

## build: Install deps and create the Vite production bundle
build:
	cd app && npm ci && npm run build

## generate-offline: Regenerate offline example data from examples/
generate-offline:
	node scripts/generate-offline-data.mjs

## seed: Seed a use case into Ory Keto (usage: make seed EXAMPLE=rbac-app-access)
seed:
	bash scripts/seed-keto.sh $(EXAMPLE)

## docker-build: Multi-stage build — compiles inside Docker, produces a distroless image
docker-build:
	docker build $(_NETWORK_FLAG) -t $(IMAGE_NAME):$(IMAGE_TAG) .

## docker-run: Run the container (reads .env for ORY_SDK_URL and ORY_ACCESS_TOKEN)
docker-run:
	docker run --rm -p $(PORT):3000 \
		$(_NETWORK_FLAG) \
		--env-file .env \
		$(IMAGE_NAME):$(IMAGE_TAG)

## clean: Remove build artifacts
clean:
	rm -rf app/dist app/node_modules
