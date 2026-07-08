#!/usr/bin/env bash
# Build (and optionally push) the HAIVE Docker image as a multi-arch manifest.
#
# Reads the version from package.json and produces two tags: :<version> and :latest.
# Uses `docker buildx` so one build serves PC (linux/amd64) and Raspberry Pi
# (linux/arm64) targets from a single manifest.
#
# Env vars:
#   DOCKER_USER   Docker Hub username (or full namespace, e.g. ghcr.io/owner). Required.
#   REPO          Image repo name. Default: haive.
#   PLATFORMS     Comma-separated buildx platforms. Default: linux/amd64,linux/arm64
#                 (add linux/arm/v7 for 32-bit Raspberry Pi OS).
#
# Flags:
#   --push        Push the built manifest to the registry (docker login first).
#                 Without it, a single-arch image is loaded into the local daemon.
#
# Examples:
#   DOCKER_USER=yourname ./deploy/publish-image.sh
#   DOCKER_USER=yourname ./deploy/publish-image.sh --push
set -euo pipefail

: "${DOCKER_USER:?Set DOCKER_USER to your registry username (e.g. yourname).}"
REPO="${REPO:-haive}"
PLATFORMS="${PLATFORMS:-linux/amd64,linux/arm64}"

PUSH=0
for arg in "$@"; do
  case "$arg" in
    --push) PUSH=1 ;;
    *) echo "Unknown argument: $arg" >&2; exit 2 ;;
  esac
done

cd "$(dirname "$0")/.."

VERSION="$(node -p "require('./package.json').version")"
IMAGE="${DOCKER_USER}/${REPO}"
TAG_VERSION="${IMAGE}:${VERSION}"
TAG_LATEST="${IMAGE}:latest"

echo ""
echo "==> HAIVE image build"
echo "    Image     : ${IMAGE}"
echo "    Version   : ${VERSION}"
echo "    Platforms : ${PLATFORMS}"
echo "    Mode      : $([ "$PUSH" -eq 1 ] && echo 'BUILD + PUSH' || echo 'BUILD (local --load)')"
echo ""

BUILDER="haive-builder"
if ! docker buildx ls | grep -q "^${BUILDER}\b"; then
  echo "==> Creating buildx builder '${BUILDER}'..."
  docker buildx create --name "${BUILDER}" --use --bootstrap >/dev/null
else
  docker buildx use "${BUILDER}" >/dev/null
fi

if [ "$PUSH" -eq 1 ]; then
  docker buildx build \
    --platform "${PLATFORMS}" \
    -t "${TAG_VERSION}" \
    -t "${TAG_LATEST}" \
    --push \
    .
else
  # --load only supports a single platform — use the host's arch.
  case "$(uname -m)" in
    aarch64|arm64) HOST_ARCH="linux/arm64" ;;
    *)             HOST_ARCH="linux/amd64" ;;
  esac
  echo "==> Local build: overriding platforms to ${HOST_ARCH} (--load only supports one)."
  docker buildx build \
    --platform "${HOST_ARCH}" \
    -t "${TAG_VERSION}" \
    -t "${TAG_LATEST}" \
    --load \
    .
fi

echo ""
echo "==> Done."
echo "    ${TAG_VERSION}"
echo "    ${TAG_LATEST}"
if [ "$PUSH" -eq 1 ]; then
  echo ""
  echo "Inspect the pushed manifest:"
  echo "  docker buildx imagetools inspect ${TAG_LATEST}"
fi
