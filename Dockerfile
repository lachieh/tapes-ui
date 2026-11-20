# syntax=docker/dockerfile:1
FROM --platform=$BUILDPLATFORM node:24.13-alpine@sha256:4f696fbf39f383c1e486030ba6b289a5d9af541642fc78ab197e584a113b9c03 AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm test && npm run build

FROM caddy:2.11.9-alpine@sha256:003a97808e781aa9f7e75cc2f43d34d461099031faf5e20faefb9f61126836f0
ENV XDG_CONFIG_HOME=/tmp XDG_DATA_HOME=/tmp
COPY Caddyfile /etc/caddy/Caddyfile
COPY --from=build /src/dist /srv
USER 65532:65532
EXPOSE 8080
CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
