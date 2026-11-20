# syntax=docker/dockerfile:1
FROM --platform=$BUILDPLATFORM node:24.22-alpine@sha256:116b800c3754b440ee0aa3ed2f20f5bf3d99a554bfd9adeea09ea8017f6e85f5 AS build
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
