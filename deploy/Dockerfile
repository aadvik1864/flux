# Pinned Node 22 / Alpine and PostgreSQL images. Update digests deliberately in CI.
FROM node:25-alpine@sha256:bdf2cca6fe3dabd014ea60163eca3f0f7015fbd5c7ee1b0e9ccb4ced6eb02ef4 AS build
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
RUN npm run db:generate && npm run build:packages && npm run build -w @flux/api && npm run build -w @flux/collaboration
# No credentials, environment file, or deployment-specific public URL enters the build.
RUN FLUX_STANDALONE=true API_INTERNAL_URL=http://api:4000 npm run build -w @flux/web

FROM build AS tools
USER node
WORKDIR /app/apps/api
CMD ["node", "dist/operations.js", "maintenance"]

FROM build AS production-dependencies
RUN npm prune --omit=dev

FROM node:25-alpine@sha256:bdf2cca6fe3dabd014ea60163eca3f0f7015fbd5c7ee1b0e9ccb4ced6eb02ef4 AS service
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

FROM node:25-alpine@sha256:bdf2cca6fe3dabd014ea60163eca3f0f7015fbd5c7ee1b0e9ccb4ced6eb02ef4 AS web
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000 NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /app/apps/web/public ./apps/web/public
COPY --from=build /app/docs/licenses ./licenses
COPY --from=build /app/apps/web/app/fonts/OFL.txt ./licenses/fonts-OFL.txt
USER node
CMD ["node", "apps/web/server.js"]
