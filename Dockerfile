# ============================================
# Stage 1: Build the web client
# ============================================
FROM node:24-alpine AS builder

RUN apk add --no-cache git python3 make g++

RUN corepack enable && corepack prepare pnpm@10.28.1 --activate

WORKDIR /build

# Copy workspace root files
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./

# Copy all package.json files for dependency graph
COPY packages/stoat.js/package.json packages/stoat.js/
COPY packages/solid-livekit-components/package.json packages/solid-livekit-components/
COPY packages/js-lingui-solid/packages/babel-plugin-lingui-macro/package.json packages/js-lingui-solid/packages/babel-plugin-lingui-macro/
COPY packages/js-lingui-solid/packages/babel-plugin-extract-messages/package.json packages/js-lingui-solid/packages/babel-plugin-extract-messages/
COPY packages/js-lingui-solid/packages/jest-mocks/package.json packages/js-lingui-solid/packages/jest-mocks/
COPY packages/client/package.json packages/client/

# Copy panda config needed for prepare step
COPY packages/client/panda.config.ts packages/client/

# *** FIX: copy full source BEFORE pnpm install ***
COPY packages/ packages/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Build workspace packages
RUN pnpm --filter stoat.js build && \
    pnpm --filter solid-livekit-components build && \
    pnpm --filter @lingui-solid/babel-plugin-lingui-macro build && \
    pnpm --filter @lingui-solid/babel-plugin-extract-messages build && \
    pnpm --filter client exec lingui compile --typescript && \
    pnpm --filter client exec node scripts/copyAssets.mjs && \
    pnpm --filter client exec panda codegen

# Build client
ENV VITE_API_URL=__VITE_API_URL__
ENV VITE_WS_URL=__VITE_WS_URL__
ENV VITE_MEDIA_URL=__VITE_MEDIA_URL__
ENV VITE_PROXY_URL=__VITE_PROXY_URL__
ENV VITE_HCAPTCHA_SITEKEY=__VITE_HCAPTCHA_SITEKEY__
ENV VITE_CFG_ENABLE_VIDEO=__VITE_CFG_ENABLE_VIDEO__
ENV VITE_GIFBOX_URL=__VITE_GIFBOX_URL__
ENV BASE_PATH=/

RUN pnpm --filter client exec vite build

# ============================================
# Stage 2: Runtime
# ============================================
FROM node:24-alpine

WORKDIR /app

COPY docker/package.json docker/inject.js ./
RUN npm install --omit=dev

COPY --from=builder /build/packages/client/dist ./dist

EXPOSE 5000

ENV VITE_API_URL=""
ENV VITE_WS_URL=""
ENV VITE_MEDIA_URL=""
ENV VITE_PROXY_URL=""
ENV VITE_HCAPTCHA_SITEKEY=""
ENV VITE_CFG_ENABLE_VIDEO=""
ENV VITE_GIFBOX_URL=""
ENV REVOLT_PUBLIC_URL=""

CMD ["npm", "start"]
