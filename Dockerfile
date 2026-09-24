FROM node:22-slim AS builder

WORKDIR /app

# Build tools for native addons (better-sqlite3 via node-gyp)
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

# Install server dependencies (includes native better-sqlite3)
COPY app/server/package*.json server/
RUN cd server && npm install

# Install client dependencies and build
COPY app/client/package*.json client/
RUN cd client && npm install
COPY app/client/ client/
# vite.config.ts reads ../../package.json (resolves to /package.json inside image)
COPY package.json /package.json
# The commit the image is built from, shown in the sidebar and /api/health.
# A build arg rather than a file: the build context carries no .git (a
# submodule's is a pointer outside it), and a clean checkout has no GIT_HASH.
ARG GIT_HASH=unknown
RUN printf '%s\n' "$GIT_HASH" > /GIT_HASH
RUN cd client && npm run build

# --- Production image (no build tools) ---
FROM node:22-slim

WORKDIR /app

# Copy built server node_modules (includes native better-sqlite3 binary)
COPY --from=builder /app/server/node_modules server/node_modules

# Copy built client dist
COPY --from=builder /app/client/dist client/dist

# Copy server source
COPY app/server/src server/src
COPY app/server/tsconfig.json server/
COPY app/server/package.json server/

# Copy VERSION and GIT_HASH files for /api/health endpoint
COPY VERSION /app/VERSION
COPY --from=builder /GIT_HASH /app/GIT_HASH

# Copy CHANGELOG for /api/changelog endpoint
COPY CHANGELOG.md /app/CHANGELOG.md

EXPOSE 4981

WORKDIR /app/server
CMD ["npx", "tsx", "src/index.ts"]
