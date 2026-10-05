# syntax=docker/dockerfile:1

# ---- Stage 1: build the React frontend ----
FROM node:22-slim AS web-build
WORKDIR /web
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
# The server/web contract the app imports as @contract (see web/vite.config.ts),
# at the same place relative to web/ as in the repo.
COPY server/src/contract /server/src/contract
RUN npm run build

# ---- Stage 2: compile the Express backend + generate Prisma client ----
FROM node:22-slim AS server-build
WORKDIR /server
COPY server/package*.json ./
RUN npm ci
COPY server/prisma ./prisma
RUN npm run prisma:generate
COPY server/ ./
RUN npm run build

# ---- Stage 3: lean runtime image ----
# Trixie (Debian 13) rather than bookworm purely for ffmpeg: bookworm ships
# 5.1, which has neither -readrate_initial_burst (6.1+) nor -readrate_catchup
# (7.0+), so every viewer connected with no buffer cushion and no way to earn
# one back after a stall — the streaming path asks for both and silently went
# without. Trixie ships 7.1. The build stages stay where they are; only
# compiled JS crosses from them, and this is the stage ffmpeg comes from.
FROM node:22-trixie-slim AS runtime
# ffmpeg = streaming pipeline; openssl = required by Prisma;
# fonts-dejavu-core = the fallback for any glyph the on-screen info cards'
# bundled Inter faces (server/assets/fonts) don't have.
#
# Then GPU encoding on Intel and AMD (NVIDIA's runtime mounts its own driver
# in). ffmpeg lists h264_vaapi and h264_qsv either way, but without a driver
# behind them the test encode fails and every channel falls back to the CPU —
# and --no-install-recommends leaves every driver out. iHD (Broadwell and
# newer) and i965 (older) are VA-API for Intel, their non-free builds carrying
# the encoders older chips need; libmfx-gen is QuickSync on 11th-gen Core, Arc
# and newer (older Intel encodes through VA-API); mesa-va-drivers is AMD. About
# 60 MB, all amd64, as the image is.
RUN sed -i 's/^Components: main$/Components: main non-free/' /etc/apt/sources.list.d/debian.sources \
  && apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg openssl ca-certificates fonts-dejavu-core \
    intel-media-va-driver-non-free i965-va-driver-shaders libmfx-gen1.2 mesa-va-drivers \
  && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
ENV DATABASE_URL=file:/app/data/mosaictv.db
WORKDIR /app

# Production dependencies (includes prisma CLI + client) + generated clients:
# the app's, and the frozen 0.12.0 baseline one the legacy data migrations use.
# prisma/ carries the versioned migrations the server applies at startup.
COPY server/package*.json ./
RUN npm ci --omit=dev
COPY server/prisma ./prisma
RUN npm run prisma:generate

# Compiled backend + built frontend, and the fonts the info cards render with
# (card.ts finds them at ../../assets from dist/streaming)
COPY --from=server-build /server/dist ./dist
COPY server/assets ./assets
COPY --from=web-build /web/dist ./public
COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

# Set by CI ("0.14.0" for a release, "0.14.0+cb8eee7" otherwise); empty means
# the version in package.json. Last, so a new commit doesn't rebuild the layers
# above it.
ARG APP_VERSION=
ENV APP_VERSION=${APP_VERSION}

EXPOSE 8688
CMD ["./docker-entrypoint.sh"]
