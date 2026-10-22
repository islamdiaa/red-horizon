#!/bin/bash
# Provision the Ubuntu 24.04 lab VM (run as root by `lab.sh provision ubuntu`; idempotent).
# Installs Google Chrome (stable), Firefox (Mozilla's deb, not the snap), Node LTS,
# Playwright with chromium/firefox/webkit, xvfb and iproute2 (tc/netem).
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
LAB_USER=${LAB_USER:-rhlab}
PW_VERSION=${PW_VERSION:-1.64.1}
APT="apt-get -y -o DPkg::Lock::Timeout=900"
HOME_DIR=$(getent passwd "$LAB_USER" | cut -d: -f6)

echo "== base packages"
# No background apt runs or upgrade reboots in the middle of a test.
systemctl disable --now unattended-upgrades.service apt-daily.timer apt-daily-upgrade.timer 2>/dev/null || true
$APT update
$APT install --no-install-recommends ca-certificates curl gnupg jq unzip xz-utils git \
  xvfb xauth x11-utils iproute2 iputils-ping mesa-utils fonts-liberation fonts-noto-color-emoji \
  qemu-guest-agent

install -d -m 0755 /etc/apt/keyrings
echo "== Google Chrome"
if [ ! -f /etc/apt/sources.list.d/google-chrome.list ]; then
  curl -fsSL https://dl.google.com/linux/linux_signing_key.pub | gpg --dearmor --yes -o /etc/apt/keyrings/google-chrome.gpg
  echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/google-chrome.gpg] https://dl.google.com/linux/chrome/deb/ stable main" \
    > /etc/apt/sources.list.d/google-chrome.list
fi
echo "== Firefox (packages.mozilla.org)"
if [ ! -f /etc/apt/sources.list.d/mozilla.list ]; then
  curl -fsSL https://packages.mozilla.org/apt/repo-signing-key.gpg -o /etc/apt/keyrings/packages.mozilla.org.asc
  echo "deb [signed-by=/etc/apt/keyrings/packages.mozilla.org.asc] https://packages.mozilla.org/apt mozilla main" \
    > /etc/apt/sources.list.d/mozilla.list
  printf 'Package: *\nPin: origin packages.mozilla.org\nPin-Priority: 1000\n' > /etc/apt/preferences.d/mozilla
fi
$APT update
snap remove firefox >/dev/null 2>&1 || true
$APT install google-chrome-stable firefox

echo "== Node LTS"
NODE_VER=$(curl -fsSL https://nodejs.org/dist/index.json | jq -r '[.[] | select(.lts != false)][0].version')
if [ "$(node -v 2>/dev/null || true)" != "$NODE_VER" ]; then
  tmp=$(mktemp -d)
  curl -fsSL -o "$tmp/node.tar.xz" "https://nodejs.org/dist/$NODE_VER/node-$NODE_VER-linux-x64.tar.xz"
  curl -fsSL -o "$tmp/SHASUMS256.txt" "https://nodejs.org/dist/$NODE_VER/SHASUMS256.txt"
  (cd "$tmp" && grep " node-$NODE_VER-linux-x64.tar.xz\$" SHASUMS256.txt | sed 's/node-.*/node.tar.xz/' | sha256sum -c -)
  tar -xJf "$tmp/node.tar.xz" -C /usr/local --strip-components=1 --no-same-owner
  rm -rf "$tmp"
fi
node -v

echo "== Playwright $PW_VERSION"
sudo -u "$LAB_USER" -H bash -c "
  set -e; mkdir -p ~/pw/jobs ~/pw/out; cd ~/pw
  [ -f package.json ] || echo '{\"name\":\"rh-lab-pw\",\"private\":true,\"type\":\"module\"}' > package.json
  npm install --no-audit --no-fund --loglevel=error playwright@$PW_VERSION
  npx playwright install chromium firefox webkit
"
(cd "$HOME_DIR/pw" && npx playwright install-deps chromium firefox webkit)

echo "== versions"
google-chrome --version; firefox --version 2>/dev/null || true; node -v
sudo -u "$LAB_USER" -H bash -c "cd ~/pw && npx playwright --version"
tc -V
