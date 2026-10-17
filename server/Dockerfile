# Red Horizon relay and verified leaderboards: Node + ws, no database. Built from the repository root, because
# the leaderboard re-simulates runs with the game's own engine (src/), bundled in.
#   docker build -f server/Dockerfile -t red-horizon-relay .
#   docker run -d --read-only --tmpfs /tmp --cap-drop ALL --security-opt no-new-privileges -v relay-data:/data red-horizon-relay
FROM node:22-slim AS build
WORKDIR /app
COPY server/package.json server/package-lock.json server/
RUN npm ci --prefix server --no-audit --no-fund
COPY src src
COPY server server
RUN cd server && node build.mjs

# runtime: two bundled files, no node_modules, an unprivileged user, a read-only root filesystem
FROM node:22-alpine
ENV NODE_ENV=production RELAY_PORT=8787 RELAY_HOST=0.0.0.0 LB_FILE=/data/leaderboard.json
WORKDIR /app
COPY --from=build /app/server/dist/relay.mjs /app/server/dist/verify-worker.mjs ./
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8787/relay/healthz >/dev/null || exit 1
CMD ["node", "--max-old-space-size=256", "relay.mjs"]
