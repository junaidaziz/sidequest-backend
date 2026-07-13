# Multi-stage build: compile TypeScript + generate the Prisma client in a
# full build environment, then ship only the production runtime into a lean
# final image (no devDependencies, no TS sources, no build toolchain).

FROM node:22-alpine AS builder
WORKDIR /app

# bcrypt has a native binding; alpine (musl libc) needs a full toolchain to
# rebuild it from source rather than using the prebuilt glibc binary.
RUN apk add --no-cache python3 make g++ openssl

COPY package*.json ./
RUN npm ci

COPY prisma ./prisma
RUN npx prisma generate

COPY tsconfig*.json nest-cli.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN apk add --no-cache python3 make g++ openssl

COPY package*.json ./
RUN npm ci --omit=dev

# Re-fetch the Prisma engine binaries against this stage's platform rather
# than trusting the builder stage's copy — both stages already share the
# same base image/arch here, but generating fresh is cheap and removes any
# doubt if that ever changes.
COPY prisma ./prisma
RUN npx prisma generate

COPY --from=builder /app/dist ./dist
COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

USER node
EXPOSE 3000

ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "dist/main"]
