FROM node:20-bookworm-slim AS build
WORKDIR /app

# npm install has been flaky in some Docker Desktop environments ("Exit handler never called!").
# Use pnpm via corepack for a more reliable dependency install.
ENV CI=true \
    PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH

RUN corepack enable \
    && corepack prepare pnpm@9.15.5 --activate

COPY package.json package-lock.json ./
# Convert npm lockfile -> pnpm lockfile inside the image (repo stays unchanged)
# then install dependencies (includes dev deps needed for vite build).
RUN pnpm import \
    && pnpm install --no-frozen-lockfile

COPY . .
RUN pnpm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 4200
CMD ["nginx", "-g", "daemon off;"]
