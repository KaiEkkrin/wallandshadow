# Wall & Shadow Dev Container
# Node 22 LTS with development dependencies

FROM mcr.microsoft.com/devcontainers/typescript-node:22-trixie

# Install system dependencies and GitHub CLI
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
    unzip \
    postgresql-17 \
    && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | gpg --dearmor -o /usr/share/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | tee /etc/apt/sources.list.d/github-cli.list \
    && apt-get update \
    && apt-get -y install gh \
    && apt-get clean -y && rm -rf /var/lib/apt/lists/*

# Add PostgreSQL binaries to PATH so pg_ctl, psql, initdb etc. work in all shell sessions
ENV PATH="/usr/lib/postgresql/17/bin:${PATH}"

# Install RustFS, the S3-compatible object store used for local dev (a static musl
# binary, no dependencies). It replaced MinIO, which no longer distributes binaries.
# Buckets are created with curl's built-in SigV4 signing (post-start.sh), so no
# separate S3 CLI is needed.
ARG RUSTFS_VERSION=1.0.0-rc.6
RUN case "$(dpkg --print-architecture)" in \
        amd64) RUSTFS_ARCH=x86_64 ;; \
        arm64) RUSTFS_ARCH=aarch64 ;; \
        *) echo "Unsupported architecture for RustFS: $(dpkg --print-architecture)" >&2; exit 1 ;; \
    esac \
    && curl -fsSL "https://github.com/rustfs/rustfs/releases/download/${RUSTFS_VERSION}/rustfs-linux-${RUSTFS_ARCH}-musl-v${RUSTFS_VERSION}.zip" -o /tmp/rustfs.zip \
    && unzip -o /tmp/rustfs.zip rustfs -d /usr/local/bin \
    && chmod +x /usr/local/bin/rustfs \
    && rm /tmp/rustfs.zip \
    && rustfs --version

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
