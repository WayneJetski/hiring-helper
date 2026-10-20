#!/usr/bin/env bash
# Hiring Helper installer for macOS and Linux.
#
#   curl -fsSL https://raw.githubusercontent.com/WayneJetski/hiring-helper/main/install.sh | bash
#
# It installs git if it is missing, downloads Hiring Helper, installs what the app
# needs (Node.js, Claude Code), adds a `hiring-helper` command, starts the app and
# opens it in your browser. It asks a few questions, each with a default (press
# Enter to accept it). Re-running it updates an existing install.
#
# Options (or the environment variable in brackets):
#   --yes, -y         accept every default, ask nothing            [HH_YES=1]
#   --dir <folder>    where to install                             [HH_DIR]
#   --port <number>   the port the app listens on                  [HH_PORT]
#   --branch <name>   which branch to install                      [HH_BRANCH]
#   --no-path         do not add the hiring-helper command to PATH [HH_NO_PATH=1]
#   --no-start        install, but do not start the app            [HH_NO_START=1]
#   --no-open         start the app, but do not open the browser   [HH_NO_BROWSER=1]
#   --help            show this text

set -euo pipefail

REPO_URL="${HH_REPO_URL:-https://github.com/WayneJetski/hiring-helper.git}"
BRANCH="${HH_BRANCH:-main}"
# Not a port other tools use (3000, 5173, 8000, 8080 are all taken by something).
DEFAULT_PORT=28417

INSTALL_DIR="${HH_DIR:-}"
PORT="${HH_PORT:-}"
ASSUME_YES="${HH_YES:-}"
ADD_TO_PATH=1
START_NOW=1
OPEN_BROWSER=1
[ -z "${HH_NO_PATH:-}" ] || ADD_TO_PATH=0
[ -z "${HH_NO_START:-}" ] || START_NOW=0
[ -z "${HH_NO_BROWSER:-}" ] || OPEN_BROWSER=0

say() { printf '\n==> %s\n' "$1"; }
note() { printf '%s\n' "$1"; }
die() { printf '\nProblem: %s\n' "$1" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

usage() {
  cat <<'USAGE'
Hiring Helper installer for macOS and Linux.

Installs git if it is missing, downloads Hiring Helper, installs what the app needs
(Node.js, Claude Code), adds a `hiring-helper` command, starts the app and opens it
in your browser. It asks a few questions, each with a default (press Enter to accept
it). Re-running it updates an existing install.

Options (or the environment variable in brackets):
  --yes, -y         accept every default, ask nothing            [HH_YES=1]
  --dir <folder>    where to install                             [HH_DIR]
  --port <number>   the port the app listens on                  [HH_PORT]
  --branch <name>   which branch to install                      [HH_BRANCH]
  --no-path         do not add the hiring-helper command to PATH [HH_NO_PATH=1]
  --no-start        install, but do not start the app            [HH_NO_START=1]
  --no-open         start the app, but do not open the browser   [HH_NO_BROWSER=1]
  --help            show this text

With curl, pass options after "bash -s --":
  curl -fsSL <url>/install.sh | bash -s -- --port 28417 --yes
USAGE
}

# ------------------------------------------------------------------ questions

# Questions are read from the keyboard even when this script itself arrives through a pipe.
can_ask() {
  [ -z "$ASSUME_YES" ] && ( : < /dev/tty ) 2>/dev/null
}

# ask "Question" "default"   (answer ends up in $ANSWER)
ask() {
  if can_ask; then
    printf '%s [%s]: ' "$1" "$2" > /dev/tty
    IFS= read -r ANSWER < /dev/tty || ANSWER=""
    ANSWER="${ANSWER:-$2}"
  else
    ANSWER="$2"
  fi
}

# confirm "Question" y|n   (succeeds for yes)
confirm() {
  local default="$2" hint reply
  if [ "$default" = y ]; then hint="Y/n"; else hint="y/N"; fi
  if can_ask; then
    printf '%s [%s]: ' "$1" "$hint" > /dev/tty
    IFS= read -r reply < /dev/tty || reply=""
    reply="${reply:-$default}"
  else
    reply="$default"
  fi
  case "$reply" in [Yy]*) return 0 ;; *) return 1 ;; esac
}

port_in_use() {
  ( exec 3<>"/dev/tcp/127.0.0.1/$1" ) 2>/dev/null
}

valid_port() {
  case "$1" in ''|*[!0-9]*) return 1 ;; esac
  [ "$1" -ge 1024 ] && [ "$1" -le 65535 ]
}

default_install_dir() {
  case "$(uname -s)" in
    Darwin) printf '%s' "$HOME/Library/Application Support/hiring-helper" ;;
    *) printf '%s' "${XDG_DATA_HOME:-$HOME/.local/share}/hiring-helper" ;;
  esac
}

existing_port() {
  [ -f "$1/.env" ] || return 0
  sed -n 's/^[[:space:]]*PORT[[:space:]]*=[[:space:]]*\([0-9][0-9]*\).*/\1/p' "$1/.env" | head -n1
}

# ------------------------------------------------------------------------ git

git_works() { have git && git --version >/dev/null 2>&1; }

run_privileged() {
  if [ "$(id -u)" -eq 0 ]; then "$@"
  elif have sudo; then sudo "$@"
  else die "Installing git needs administrator rights, and sudo is not available. Install git yourself, then run this again."
  fi
}

install_git_macos() {
  if have brew; then
    note "Installing git with Homebrew..."
    brew install git
    return 0
  fi
  note "Installing git needs Apple's command line developer tools."
  note "A window will ask you to install them: click Install, and wait for it to finish."
  xcode-select --install >/dev/null 2>&1 || true
  local waited=0
  until git_works; do
    [ "$waited" -lt 1800 ] || die "git was not installed within 30 minutes. Install the command line developer tools, then run this again."
    sleep 5
    waited=$((waited + 5))
  done
}

install_git_linux() {
  note "Installing git..."
  if have apt-get; then run_privileged apt-get update -y && run_privileged apt-get install -y git
  elif have dnf; then run_privileged dnf install -y git
  elif have yum; then run_privileged yum install -y git
  elif have pacman; then run_privileged pacman -Sy --noconfirm git
  elif have zypper; then run_privileged zypper --non-interactive install git
  elif have apk; then run_privileged apk add git
  else die "Could not tell how to install git on this system. Install it yourself, then run this again."
  fi
}

ensure_git() {
  say "Checking git"
  if git_works; then note "git is installed ($(git --version))."; return 0; fi
  case "$(uname -s)" in
    Darwin) install_git_macos ;;
    Linux) install_git_linux ;;
    *) die "This installer supports macOS and Linux. On Windows, use install.ps1 (see the README)." ;;
  esac
  git_works || die "git could not be installed. Install it yourself, then run this again."
}

# ------------------------------------------------------------- code and config

fetch_code() {
  say "Getting Hiring Helper"
  if [ -d "$INSTALL_DIR/.git" ]; then
    note "Found an existing install in $INSTALL_DIR. Updating it."
    git -C "$INSTALL_DIR" pull --ff-only \
      || die "Could not update the existing install. If you changed files in $INSTALL_DIR, undo those changes and run this again."
  elif [ -e "$INSTALL_DIR" ] && [ -n "$(ls -A "$INSTALL_DIR" 2>/dev/null)" ]; then
    die "$INSTALL_DIR already exists and is not a Hiring Helper install. Pick another folder with --dir."
  else
    mkdir -p "$(dirname "$INSTALL_DIR")"
    git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$INSTALL_DIR" \
      || die "Could not download Hiring Helper from $REPO_URL (branch $BRANCH). Check your internet connection."
  fi
}

set_env_value() {
  local file="$1" key="$2" value="$3" temp
  temp="$(mktemp)"
  if grep -q "^$key=" "$file"; then
    awk -v key="$key" -v value="$value" 'BEGIN { FS = OFS = "=" } $1 == key { print key "=" value; next } { print }' "$file" > "$temp"
  else
    cat "$file" > "$temp"
    printf '%s=%s\n' "$key" "$value" >> "$temp"
  fi
  cat "$temp" > "$file"
  rm -f "$temp"
}

configure_env() {
  [ -f "$INSTALL_DIR/.env" ] || cp "$INSTALL_DIR/.env.example" "$INSTALL_DIR/.env"
  set_env_value "$INSTALL_DIR/.env" PORT "$PORT"
}

# -------------------------------------------------------------------- PATH

profile_file() {
  case "$(basename "${SHELL:-}")" in
    zsh) printf '%s' "${ZDOTDIR:-$HOME}/.zshrc" ;;
    bash)
      if [ "$(uname -s)" = Darwin ] && [ ! -f "$HOME/.bashrc" ]; then printf '%s' "$HOME/.bash_profile"
      else printf '%s' "$HOME/.bashrc"
      fi
      ;;
    fish) printf '%s' "$HOME/.config/fish/config.fish" ;;
    *) printf '%s' "$HOME/.profile" ;;
  esac
}

add_command_to_path() {
  local profile bin_dir start_marker="# >>> hiring-helper >>>" end_marker="# <<< hiring-helper <<<" temp
  profile="$(profile_file)"
  bin_dir="$INSTALL_DIR/bin"
  mkdir -p "$(dirname "$profile")"
  touch "$profile"

  # Replace an earlier block (an older install folder) rather than adding a second one.
  if grep -qF "$start_marker" "$profile"; then
    temp="$(mktemp)"
    awk -v s="$start_marker" -v e="$end_marker" '$0 == s { skip = 1; next } $0 == e { skip = 0; next } !skip { print }' "$profile" > "$temp"
    cat "$temp" > "$profile"
    rm -f "$temp"
  fi

  {
    printf '\n%s\n' "$start_marker"
    if [ "$(basename "${SHELL:-}")" = fish ]; then
      printf 'fish_add_path "%s"\n' "$bin_dir"
    else
      printf 'export PATH="%s:$PATH"\n' "$bin_dir"
    fi
    printf '%s\n' "$end_marker"
  } >> "$profile"
  note "Added the hiring-helper command to $profile. Open a new terminal to use it."
}

# -------------------------------------------------------------------- main

main() {
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --yes|-y) ASSUME_YES=1 ;;
      --dir) [ "$#" -ge 2 ] || die "--dir needs a folder."; INSTALL_DIR="$2"; shift ;;
      --port) [ "$#" -ge 2 ] || die "--port needs a number."; PORT="$2"; shift ;;
      --branch) [ "$#" -ge 2 ] || die "--branch needs a name."; BRANCH="$2"; shift ;;
      --no-path) ADD_TO_PATH=0 ;;
      --no-start) START_NOW=0 ;;
      --no-open) OPEN_BROWSER=0 ;;
      --help|-h) usage; exit 0 ;;
      *) die "Unknown option: $1 (try --help)." ;;
    esac
    shift
  done

  printf '\nHiring Helper installer\n'
  [ -n "$ASSUME_YES" ] || can_ask || note "(No keyboard available, so every default is used.)"

  # Questions first, so everything after them runs without waiting for you.
  if [ -z "$INSTALL_DIR" ]; then
    ask "Install folder" "$(default_install_dir)"
    INSTALL_DIR="$ANSWER"
  fi
  case "$INSTALL_DIR" in "~"|"~/"*) INSTALL_DIR="$HOME${INSTALL_DIR#\~}" ;; esac

  if [ -z "$PORT" ]; then
    local suggested
    suggested="$(existing_port "$INSTALL_DIR")"
    suggested="${suggested:-$DEFAULT_PORT}"
    while :; do
      ask "Port for the app (an uncommon one avoids clashes with other tools)" "$suggested"
      PORT="$ANSWER"
      if ! valid_port "$PORT"; then note "Please enter a number from 1024 to 65535."; PORT=""; can_ask || die "Invalid port."; continue; fi
      if port_in_use "$PORT" && [ "$PORT" != "$(existing_port "$INSTALL_DIR")" ]; then
        note "Something is already using port $PORT."
        can_ask || break
        PORT=""
        continue
      fi
      break
    done
  elif ! valid_port "$PORT"; then
    die "The port must be a number from 1024 to 65535 (got \"$PORT\")."
  fi

  if [ "$ADD_TO_PATH" = 1 ] && ! confirm "Add the hiring-helper command to your PATH?" y; then ADD_TO_PATH=0; fi
  if [ "$START_NOW" = 1 ] && ! confirm "Start Hiring Helper when the install finishes?" y; then START_NOW=0; fi

  ensure_git
  fetch_code
  configure_env
  [ "$ADD_TO_PATH" = 0 ] || add_command_to_path

  say "Installed in $INSTALL_DIR (port $PORT)"
  if [ "$START_NOW" = 1 ]; then
    local start_args=(start)
    [ "$OPEN_BROWSER" = 1 ] || start_args+=(--no-open)
    "$INSTALL_DIR/bin/hiring-helper" "${start_args[@]}"
  else
    note "Start it any time with: \"$INSTALL_DIR/bin/hiring-helper\" start"
  fi

  cat <<COMMANDS

Everyday commands (in a new terminal):
  hiring-helper start      start it and open the browser
  hiring-helper stop       stop it
  hiring-helper status     is it running?
  hiring-helper update     download the latest version
COMMANDS
}

main "$@"
