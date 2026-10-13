# Pinned Node 22 / Alpine. Update digests deliberately in CI.
FROM node:22-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402 AS dependencies
RUN apk add --no-cache openssl
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/collaboration/package.json apps/collaboration/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/document-model/package.json packages/document-model/package.json
COPY packages/storage/package.json packages/storage/package.json
RUN npm ci
COPY . .

FROM dependencies AS build
RUN npm run db:generate && npm run build:packages && npm run build -w @flux/api && npm run build -w @flux/collaboration

FROM dependencies AS web-build
RUN npm run build -w @flux/shared && npm run build -w @flux/document-model
# No credentials, environment file, or deployment-specific public URL enters the build.
RUN FLUX_STANDALONE=true API_INTERNAL_URL=http://api:4000 npm run build -w @flux/web

FROM build AS tools
USER node
WORKDIR /app/apps/api
CMD ["node", "dist/operations.js", "maintenance"]

FROM build AS production-dependencies
RUN npm prune --omit=dev

FROM node:22-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402 AS service
RUN apk add --no-cache openssl
ENV NODE_ENV=production
WORKDIR /app
COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/packages ./packages
COPY --from=build --chown=node:node /app/apps/api/dist ./apps/api/dist
COPY --from=build --chown=node:node /app/apps/api/package.json ./apps/api/package.json
COPY --from=build --chown=node:node /app/apps/collaboration/dist ./apps/collaboration/dist
COPY --from=build --chown=node:node /app/apps/collaboration/package.json ./apps/collaboration/package.json
COPY --from=build /app/docs/licenses ./licenses
USER node

FROM service AS api
WORKDIR /app/apps/api
CMD ["node", "dist/main.js"]

FROM service AS collaboration
WORKDIR /app/apps/collaboration
CMD ["node", "dist/server.js"]

FROM node:22-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402 AS web
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000 NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY --from=web-build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=web-build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=web-build --chown=node:node /app/apps/web/public ./apps/web/public
COPY --from=web-build /app/docs/licenses ./licenses
COPY --from=web-build /app/apps/web/app/fonts/OFL.txt ./licenses/fonts-OFL.txt
USER node
CMD ["node", "apps/web/server.js"]
