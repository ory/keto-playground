FROM node:24-slim AS build
WORKDIR /build

COPY app/package.json app/package-lock.json ./
RUN npm ci

COPY app/index.html app/vite.config.ts app/tsconfig.json ./
COPY app/src ./src
# vite.config.ts imports ../proxy-policy.mjs for the dev proxy
COPY proxy-policy.mjs proxy-policy.d.mts /
COPY app/public ./public
RUN npm run build

FROM node:24-slim AS server-deps
WORKDIR /server
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM gcr.io/distroless/nodejs24-debian13:nonroot
WORKDIR /app

COPY --from=build /build/dist ./dist
COPY --from=server-deps /server/node_modules ./node_modules
COPY server.js proxy-policy.mjs ./

# Listen on all interfaces inside the container; publish it on loopback only
# (see the Makefile) or behind an authenticating proxy.
ENV HOST=0.0.0.0

EXPOSE 3000
CMD ["server.js"]
