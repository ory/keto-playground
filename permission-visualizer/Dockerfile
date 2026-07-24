FROM node:24-slim AS build
WORKDIR /build

COPY app/package.json app/package-lock.json ./
RUN npm ci

COPY app/index.html app/vite.config.ts app/tsconfig.json ./
COPY app/src ./src
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
COPY server.js ./

EXPOSE 3000
CMD ["server.js"]
