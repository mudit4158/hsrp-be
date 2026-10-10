# Build context: repository root (see docker-compose.yml).
FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate
WORKDIR /repo

FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY packages/contracts/package.json packages/contracts/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter "@hsrp/api..."
COPY packages/contracts packages/contracts
COPY apps/api apps/api
RUN pnpm --filter @hsrp/contracts build \
 && pnpm --filter @hsrp/api exec prisma generate \
 && pnpm --filter @hsrp/api build \
 && pnpm --filter @hsrp/api deploy --prod /out \
 && rm -rf /out/dist && cp -r apps/api/dist /out/dist

FROM node:22-alpine AS runtime
RUN apk add --no-cache openssl
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out /app
COPY apps/api/docker-entrypoint.sh /app/docker-entrypoint.sh
RUN npx prisma generate && chmod +x /app/docker-entrypoint.sh
EXPOSE 3000
ENTRYPOINT ["/app/docker-entrypoint.sh"]
