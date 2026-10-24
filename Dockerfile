# Single container: the Node game server (Colyseus over WebSocket) also serves the built client.
# Build: docker build -t psst .
# Run:   docker run --rm -p 2567:2567 psst            (voice: add -e LIVEKIT_URL -e LIVEKIT_API_KEY -e LIVEKIT_API_SECRET)

FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
COPY packages/client/package.json packages/client/
# The desktop (Electron) workspace is not part of the image.
RUN npm ci -w @psst/shared -w @psst/server -w @psst/client --include-workspace-root
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY packages/client packages/client
RUN npm run build

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production PORT=2567
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
RUN npm ci -w @psst/shared -w @psst/server --omit=dev && npm cache clean --force
COPY packages/shared/src packages/shared/src
COPY packages/server/src packages/server/src
COPY --from=build /app/packages/client/dist packages/client/dist
USER node
EXPOSE 2567
CMD ["node", "--import", "tsx", "packages/server/src/index.ts"]
