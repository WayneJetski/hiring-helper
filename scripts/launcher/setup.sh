#!/usr/bin/env bash
# Hiring Helper setup (macOS and Linux).
#
# Installs what the app needs and builds it. Safe to run every time: each step is
# skipped when it is already done. `hiring-helper start` runs it first.
#
#   Node.js      downloaded into .runtime/node when the computer has no suitable one
#   Claude Code  installed with Anthropic's official installer when missing
#   The app      packages installed and built when they are out of date
#
# Set HH_SKIP_CLAUDE=1 to skip Claude Code (the app works, but cannot score).

set -euo pipefail

# Setup builds the app, which needs the development packages. A restart started by the
# running server would otherwise pass NODE_ENV=production on to npm.
unset NODE_ENV

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
RUNTIME_DIR="$REPO_ROOT/.runtime"
LOCAL_NODE_DIR="$RUNTIME_DIR/node"
BUILD_STAMP="$RUNTIME_DIR/build.stamp"

# Node line to download when the computer has no suitable Node. Even-numbered (LTS)
# lines only: better-sqlite3 ships prebuilt binaries for them, so no compiler is needed.
NODE_DOWNLOAD_LINE="v22.x"
MIN_NODE_MAJOR=20

step() { printf '\n==> %s\n' "$1"; }
have() { command -v "$1" >/dev/null 2>&1; }
die() { printf '\nProblem: %s\n' "$1" >&2; exit 1; }

add_to_path() {
  [ -d "$1" ] || return 0
  case ":$PATH:" in
    *":$1:"*) ;;
    *) PATH="$1:$PATH" ;;
  esac
  export PATH
}

sha256_of() {
  if have sha256sum; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi
}

# ---------------------------------------------------------------- Node.js

node_is_usable() {
  have node || return 1
  local major
  major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null)" || return 1
  [ "$major" -ge "$MIN_NODE_MAJOR" ] && [ $((major % 2)) -eq 0 ]
}

install_local_node() {
  local os arch platform_os platform_arch base sums line expected archive archive_path actual
  os="$(uname -s)"
  arch="$(uname -m)"
  case "$os" in
    Darwin) platform_os=darwin ;;
    Linux) platform_os=linux ;;
    *) die "This installer supports macOS and Linux (found $os)." ;;
  esac
  case "$arch" in
    x86_64|amd64) platform_arch=x64 ;;
    arm64|aarch64) platform_arch=arm64 ;;
    *) die "Unsupported processor type: $arch." ;;
  esac
  if [ "$platform_os" = linux ] && ldd --version 2>&1 | grep -qi musl; then
    die "This Linux uses musl (for example Alpine), which the official Node.js downloads do not support. Install Node.js 22 with your package manager, then run this again."
  fi

  have curl || die "curl is needed to download Node.js."
  have tar || die "tar is needed to unpack Node.js."

  base="https://nodejs.org/dist/latest-$NODE_DOWNLOAD_LINE"
  echo "Downloading Node.js ($platform_os-$platform_arch). This happens once and takes a minute..."
  sums="$(curl -fsSL "$base/SHASUMS256.txt")" || die "Could not reach nodejs.org. Check your internet connection."
  line="$(printf '%s\n' "$sums" | grep -E "node-v[0-9.]+-$platform_os-$platform_arch\.tar\.gz\$" | head -n1 || true)"
  [ -n "$line" ] || die "Could not find a Node.js download for $platform_os-$platform_arch."
  expected="${line%% *}"
  archive="${line##* }"

  mkdir -p "$RUNTIME_DIR"
  archive_path="$RUNTIME_DIR/$archive"
  curl -fsSL "$base/$archive" -o "$archive_path" || die "The Node.js download failed."
  actual="$(sha256_of "$archive_path")"
  if [ "$actual" != "$expected" ]; then
    rm -f "$archive_path"
    die "The downloaded Node.js file failed its checksum. Check your connection and try again."
  fi

  echo "Unpacking Node.js..."
  rm -rf "$LOCAL_NODE_DIR"
  mkdir -p "$LOCAL_NODE_DIR"
  tar -xzf "$archive_path" -C "$LOCAL_NODE_DIR" --strip-components=1
  rm -f "$archive_path"
}

initialize_node() {
  step "Checking Node.js"
  # The copy next to the app wins, so a previous download keeps being used.
  add_to_path "$LOCAL_NODE_DIR/bin"
  if ! node_is_usable; then
    install_local_node
    add_to_path "$LOCAL_NODE_DIR/bin"
  fi
  node_is_usable || die "Node.js could not be set up."
  echo "Node.js $(node --version) is ready."
}

# ------------------------------------------------------------------ Claude Code

initialize_claude() {
  if [ "${HH_SKIP_CLAUDE:-}" = 1 ]; then
    step "Skipping Claude Code (HH_SKIP_CLAUDE is set)"
    return 0
  fi
  step "Checking Claude Code (used to score candidates)"
  add_to_path "$HOME/.local/bin"

  if ! have claude; then
    have curl || die "curl is needed to install Claude Code."
    echo "Installing Claude Code with the official installer..."
    curl -fsSL https://claude.ai/install.sh | bash || true
    add_to_path "$HOME/.local/bin"
    have claude || die "Claude Code did not install. See https://docs.claude.com/en/docs/claude-code/overview, install it, then run this again."
  fi
  echo "Claude Code is installed ($(claude --version 2>/dev/null || echo 'version unknown'))."

  # Signing in happens in the app (setup page, "Sign in to Claude"), so this only says where things stand.
  if ! claude auth status 2>/dev/null | grep -q '"loggedIn": *true'; then
    echo "Claude Code is not signed in yet. Once the app is open, use \"Sign in to Claude\" on its setup page"
    echo "(the badge at the top right). Until then everything works except scoring."
  fi
}

# ----------------------------------------------------------- App install and build

initialize_app_files() {
  step "Checking app files"
  cd "$REPO_ROOT"
  [ -f .env ] || cp .env.example .env

  if [ ! -f node_modules/.package-lock.json ] || [ package-lock.json -nt node_modules/.package-lock.json ]; then
    echo "Installing app packages (first run takes a few minutes)..."
    # npm ci installs exactly what package-lock.json says and never rewrites it, so the folder stays clean for git.
    npm ci --include=dev --no-audit --no-fund || die "Installing the app packages failed."
  fi

  local needs_build=0
  if [ ! -f client/dist/index.html ] || [ ! -f server/dist/index.js ] || [ ! -f "$BUILD_STAMP" ]; then
    needs_build=1
  elif [ -n "$(find client/src client/index.html server/src -type f -newer "$BUILD_STAMP" 2>/dev/null | head -n 1)" ]; then
    needs_build=1
  fi
  if [ "$needs_build" -eq 1 ]; then
    echo "Building the app (first run takes a minute)..."
    npm run build || die "Building the app failed."
    mkdir -p "$RUNTIME_DIR"
    date -u +%Y-%m-%dT%H:%M:%SZ > "$BUILD_STAMP"
  fi
}

initialize_node
initialize_claude
initialize_app_files
printf '\nSetup is complete.\n'
