variable "TAG" {
  default = "local"
}

target "image" {
  context    = "."
  dockerfile = "Dockerfile"
  platforms  = ["linux/amd64", "linux/arm64"]
  tags       = ["ghcr.io/lachieh/tapes-ui:${TAG}", "ghcr.io/lachieh/tapes-ui:rolling"]
  labels = {
    "org.opencontainers.image.source" = "https://github.com/lachieh/tapes-ui"
    "org.opencontainers.image.version" = "${TAG}"
  }
}

group "default" {
  targets = ["image"]
}
