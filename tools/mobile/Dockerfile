# Android emulator host for the mobile test lab (see tools/mobile/README.md).
# The SDK and the AVD live in mounted volumes (/sdk and /avd), so the image itself stays small and
# never goes stale. The emulator runs headless with KVM; adb and the emulator console stay inside the
# container except for the adb server port, which mobile.sh publishes on the host's loopback only.
FROM ubuntu:24.04
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl unzip openjdk-17-jre-headless socat \
      libpulse0 libgl1 libegl1 libgles2 libnss3 libxcomposite1 libxcursor1 libxi6 libxtst6 libxrandr2 \
      libxdamage1 libxfixes3 libxkbfile1 libxkbcommon0 libxkbcommon-x11-0 libx11-6 libx11-xcb1 libxext6 \
      libxrender1 libxcb1 libdbus-1-3 libfontconfig1 libfreetype6 libbsd0 libdrm2 libasound2t64 \
      libgbm1 libvulkan1 libsm6 libice6 libtinfo6 libncurses6 iproute2 procps \
  && rm -rf /var/lib/apt/lists/*
ENV ANDROID_SDK_ROOT=/sdk ANDROID_HOME=/sdk ANDROID_AVD_HOME=/avd HOME=/home/emu \
    PATH=/sdk/cmdline-tools/latest/bin:/sdk/platform-tools:/sdk/emulator:$PATH
RUN mkdir -p /home/emu/.android
COPY entrypoint.sh /usr/local/bin/rh-emu
WORKDIR /home/emu
ENTRYPOINT ["/usr/local/bin/rh-emu"]
