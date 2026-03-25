FROM oven/bun:1.2.17

WORKDIR /app

# Install server dependencies
COPY apps/server/package.json apps/server/bun.lock apps/server/
RUN cd apps/server && bun install --frozen-lockfile

# Install client dependencies
COPY apps/client/package.json apps/client/bun.lock apps/client/
RUN cd apps/client && bun install --frozen-lockfile

COPY . .

EXPOSE 4000 5173

CMD ["sh", "-c", "cd /app/apps/server && bun run dev & cd /app/apps/client && bun run dev -- --host 0.0.0.0 & wait"]
