# Real-GPU browser rig: headless Chromium on the host's Mesa GPU (Intel iris / ANV),
# for checks that SwiftShader cannot do (NaN behaviour, real shader compilers, real frame times).
# Build:  docker build -t red-horizon-gpu-rig tools/gpu-rig
# Run:    see tools/gpu-rig/README.md (the repo and the Playwright browser cache are mounted read-only).
FROM ubuntu:latest

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates nodejs \
      mesa-vulkan-drivers libgl1-mesa-dri libegl1 libgles2 libgbm1 libvulkan1 vulkan-tools mesa-utils \
      libnss3 libnspr4 libatk1.0-0t64 libatk-bridge2.0-0t64 libcups2t64 libdrm2 libxkbcommon0 \
      libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libasound2t64 libpango-1.0-0 libcairo2 \
      libx11-6 libxcb1 libxext6 libdbus-1-3 libexpat1 libglib2.0-0t64 fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

# non-root user; the render node is opened through the video/render groups
RUN groupadd -f render && useradd -m -u 10001 -G video,render rig
USER rig
WORKDIR /game
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
ENTRYPOINT ["node"]
