# Red Horizon: build the static web app, then serve it with an unprivileged nginx.
#   docker build -t red-horizon .
#   docker run -d --name red-horizon -p 8091:8080 --read-only --tmpfs /tmp red-horizon
FROM node:22-slim AS build
WORKDIR /app
# browsers are only needed for the screenshot / audit tooling, not for the build
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
# the public address for link previews (absolute og:image URLs), e.g. --build-arg RH_SITE_URL=https://example.com/
ARG RH_SITE_URL=
RUN RH_SITE_URL="$RH_SITE_URL" npm run build

# nginx as a non-root user (uid 101), listening on 8080
FROM nginxinc/nginx-unprivileged:alpine
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY docker/security-headers.conf /etc/nginx/security-headers.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8080/ >/dev/null || exit 1
