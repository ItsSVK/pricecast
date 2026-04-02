# ── Stage 1: build ────────────────────────────────────────────────────────────
# Compile a self-contained binary so the production image needs no runtime deps.
FROM oven/bun:1-alpine AS builder

WORKDIR /app

# Copy manifests first for layer-cache efficiency
COPY package.json bun.lockb ./
RUN bun install --frozen-lockfile

COPY tsconfig.json ./
COPY src ./src

# Produce a single statically-linked executable
RUN bun build --compile --minify src/app.ts --outfile dist/pricecast

# ── Stage 2: production ────────────────────────────────────────────────────────
FROM debian:bookworm-slim AS production

WORKDIR /app

# The compiled binary is self-contained — no Node/Bun runtime required.
COPY --from=builder /app/dist/pricecast ./pricecast

RUN chmod +x ./pricecast

ENV PORT=8000
EXPOSE 8000

# Run as non-root for least privilege
RUN groupadd -r appuser && useradd -r -g appuser appuser
USER appuser

ENTRYPOINT ["./pricecast"]
