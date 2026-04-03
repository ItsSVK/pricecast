# ── Stage 1: build ────────────────────────────────────────────────────────────
# Compile a self-contained binary so the production image needs no runtime deps.
FROM oven/bun:1-alpine AS builder

WORKDIR /app

# Copy manifests first for layer-cache efficiency
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY tsconfig.json ./
COPY src ./src
COPY public ./public

# Produce a single statically-linked executable
RUN bun build --compile --minify src/app.ts --outfile dist/pricecast

# ── Stage 2: production ────────────────────────────────────────────────────────
# Must match the builder's libc: bun on Alpine compiles against musl, so the
# production image must also be musl-based — otherwise the binary's dynamic
# linker path (/lib/ld-musl-*) won't exist and exec fails with "no such file".
FROM alpine:3 AS production

WORKDIR /app

# Bun's compiled binary dynamically links against the C++ standard library.
# These two packages provide libstdc++.so.6 and libgcc_s.so.1 on Alpine.
RUN apk add --no-cache libstdc++ libgcc

COPY --from=builder /app/dist/pricecast ./pricecast
COPY --from=builder /app/public ./public

RUN chmod +x ./pricecast

ENV PORT=8000
EXPOSE 8000

# Run as non-root for least privilege.
# Alpine uses addgroup/adduser instead of Debian's groupadd/useradd.
RUN addgroup -S appgroup && adduser -S -G appgroup appuser
USER appuser

ENTRYPOINT ["./pricecast"]
