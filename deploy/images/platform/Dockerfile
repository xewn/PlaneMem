ARG NODE_BASE_IMAGE=node:24-alpine3.24@sha256:6a1c190e17215d844926b0677f4bf87273ff7d5e54db06d3b5b5863ab0b09a3d
FROM ${NODE_BASE_IMAGE}

# The runtime does not execute npm. Remove the base image's global npm tree and
# upgrade the Alpine zlib package so the shipped image contains only the
# runtime dependencies that the application actually needs.
RUN apk add --no-cache zlib=1.3.2-r1 \
    && rm -rf /usr/local/lib/node_modules/npm \
      /usr/local/bin/npm \
      /usr/local/bin/npx

WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000

# The staged runtime is copied from a CI/workspace filesystem that may keep
# directories mode 0700. Give the unprivileged runtime user ownership so Node
# can traverse the module tree inside the image.
COPY --chown=node:node dist ./dist
COPY --chown=node:node artifacts/runtime/node_modules ./node_modules

USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=12 \
  CMD wget -qO- http://127.0.0.1:3000/health/ready || exit 1

ENTRYPOINT ["node", "dist/apps/api-gateway/src/server.js"]
