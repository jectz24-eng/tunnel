# Build from the repository root:  docker build -f services/keeper/Dockerfile -t tunnel-keeper .
FROM node:22-slim
WORKDIR /repo
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY packages/sdk/package.json packages/sdk/
COPY packages/db/package.json packages/db/
COPY services/keeper/package.json services/keeper/
COPY app/package.json app/
COPY packages/db/prisma packages/db/prisma
COPY packages/db/prisma.config.ts packages/db/
RUN npm ci --workspace services/keeper --workspace packages/db --workspace packages/sdk --include-workspace-root=false
COPY packages packages
COPY programs/tunnel/src/errors.rs programs/tunnel/src/errors.rs
COPY services/keeper services/keeper
RUN npx --workspace packages/db prisma generate
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:8787/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Apply migrations, then run indexer + crank. KEEPER_KEYPAIR must point at a mounted secret file.
CMD ["sh", "-c", "npx --workspace packages/db prisma migrate deploy && npm run start --workspace services/keeper"]
