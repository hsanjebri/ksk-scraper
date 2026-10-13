FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
# npm is only needed to install: removed afterwards, it is no longer in the
# image to be exploited (most scanner findings on node:alpine are in npm's
# own bundled dependencies).
RUN npm ci --omit=dev && npm cache clean --force \
 && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx /root/.npm
COPY --from=build /app/dist ./dist
# Run as the image's unprivileged "node" user, not root: a compromise of the
# app then cannot modify the image's files or install anything. /app is
# writable only so a SQLite file can be created when DB_TYPE=sqlite.
RUN chown -R node:node /app
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]
