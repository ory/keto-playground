FROM node:20-slim AS build
WORKDIR /build

COPY app/package.json app/package-lock.json ./
RUN npm ci

COPY app/index.html app/vite.config.js ./
COPY app/src ./src
COPY app/public ./public
RUN npm run build

FROM gcr.io/distroless/nodejs20-debian12:nonroot
WORKDIR /app

COPY --from=build /build/dist ./dist
COPY server.js ./

EXPOSE 3000
CMD ["server.js"]
