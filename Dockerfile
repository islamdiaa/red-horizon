# Red Horizon: build the static web app, then serve it with nginx.
#   docker build -t red-horizon .
#   docker run -d --name red-horizon -p 8091:80 red-horizon
FROM node:22-slim AS build
WORKDIR /app
# browsers are only needed for the screenshot / audit tooling, not for the build
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM nginx:alpine
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1
