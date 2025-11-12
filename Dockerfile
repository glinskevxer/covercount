# The read service, and nothing else.
#
# The build stage compiles and prunes; the run stage carries the built
# JavaScript, the production dependencies and nothing that could write to the
# store. better-sqlite3 is a native addon, so the two stages have to be the
# same base image or the prebuilt binary will not load.

FROM node:22.13.1-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22.13.1-bookworm-slim AS run
WORKDIR /app

ENV NODE_ENV=production \
    COVERCOUNT_STORE=/data/property.covercount.db

RUN useradd --system --create-home --uid 10001 covercount \
    && mkdir -p /data \
    && chown covercount:covercount /data

COPY --from=build --chown=covercount:covercount /app/node_modules ./node_modules
COPY --from=build --chown=covercount:covercount /app/dist ./dist
COPY --chown=covercount:covercount package.json ./

USER covercount
EXPOSE 8377

# The service opens the store read only, so a container that is compromised
# still cannot write to the file the banquet office is working in.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:8377/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["node", "dist/src/cli/main.js"]
CMD ["serve", "start", "--host", "0.0.0.0", "--port", "8377"]
