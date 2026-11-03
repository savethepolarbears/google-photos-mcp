FROM node:22.22-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22.22-bookworm-slim
ENV NODE_ENV=production PORT=3000 TOKEN_STORAGE_PATH=data/tokens.db
WORKDIR /app
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/package.json ./package.json
RUN mkdir /app/data && chown node:node /app/data && chmod 700 /app/data
USER node
EXPOSE 3000
CMD ["node", "dist/index.js", "--remote"]
