# Wall & Shadow Dev Container
# Node 22 LTS with development dependencies

FROM mcr.microsoft.com/devcontainers/typescript-node:22-trixie

# Install system dependencies, Google Cloud SDK, and GitHub CLI
RUN apt-get update && export DEBIAN_FRONTEND=noninteractive \
    && apt-get -y install --no-install-recommends \
    build-essential \
    procps \
    imagemagick \
    rsync \
    apt-transport-https \
    ca-certificates \
    gnupg \
    curl \
    postgresql-17 \
    && echo "deb [signed-by=/usr/share/keyrings/cloud.google.gpg] https://packages.cloud.google.com/apt cloud-sdk main" | tee -a /etc/apt/sources.list.d/google-cloud-sdk.list \
    && curl https://packages.cloud.google.com/apt/doc/apt-key.gpg | gpg --dearmor -o /usr/share/keyrings/cloud.google.gpg \
    && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | gpg --dearmor -o /usr/share/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | tee /etc/apt/sources.list.d/github-cli.list \
    && apt-get update \
    && apt-get -y install google-cloud-cli gh \
    && apt-get clean -y && rm -rf /var/lib/apt/lists/*

# Add PostgreSQL binaries to PATH so pg_ctl, psql, initdb etc. work in all shell sessions
ENV PATH="/usr/lib/postgresql/17/bin:${PATH}"

# Install MinIO server and client (static binaries, no dependencies)
RUN curl -fsSL https://dl.min.io/server/minio/release/linux-amd64/minio -o /usr/local/bin/minio \
    && chmod +x /usr/local/bin/minio \
    && curl -fsSL https://dl.min.io/client/mc/release/linux-amd64/mc -o /usr/local/bin/mc \
    && chmod +x /usr/local/bin/mc

# Install Playwright system dependencies
RUN npx playwright install-deps

# Install global npm packages
RUN npm install -g npm-run-all tree-sitter-cli

# Ensure GPU groups exist for AMD ROCm support
# (harmless for non-AMD users; needed so --group-add=video/render work in Podman)
RUN groupadd -f video && groupadd -f render

# Create Homebrew prefix owned by node user (Homebrew refuses to run as root)
RUN mkdir -p /home/linuxbrew/.linuxbrew && chown -R node:node /home/linuxbrew

# Switch to node user for subsequent operations
# Note: Cache, config, and credential directories are created via symlinks
# in postCreateCommand (see .devcontainer/scripts/post-create.sh)
USER node

# Install Homebrew (non-interactive, targets /home/linuxbrew/.linuxbrew)
RUN NONINTERACTIVE=1 /bin/bash -c \
    "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Install Rust toolchain via rustup (--no-modify-path; PATH managed via ENV below)
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
    | sh -s -- -y --no-modify-path

# PATH: brew, cargo, claude local bin, plus inherited system path
ENV PATH="/home/linuxbrew/.linuxbrew/bin:/home/linuxbrew/.linuxbrew/sbin:/home/node/.cargo/bin:/home/node/.local/bin:${PATH}"

# Install CLI tools via Homebrew
RUN brew install neovim zellij fd fzf ripgrep lazygit

# Make brew and cargo available in interactive bash sessions.
# NONINTERACTIVE=1 and --no-modify-path suppress the installers' normal shell-config
# edits, so we add them manually here.  ENV PATH above covers Docker RUN steps; this
# covers interactive terminals (which read ~/.bashrc, not Docker's ENV).
RUN echo 'eval "$(/home/linuxbrew/.linuxbrew/bin/brew shellenv)"' >> ~/.bashrc \
    && echo '[ -f "$HOME/.cargo/env" ] && . "$HOME/.cargo/env"' >> ~/.bashrc

# Install Claude Code CLI as node user (native binary installs to ~/.local/bin)
RUN curl -fsSL https://claude.ai/install.sh | bash

ENV EDITOR=nvim
ENV VISUAL=nvim

# Set working directory to VS Code's default for container volumes
WORKDIR /workspaces
