# Wall & Shadow Dev Container
# Node 22 LTS with Firebase tools, Java for emulators, and development dependencies

FROM mcr.microsoft.com/devcontainers/typescript-node:22-trixie

# Install system dependencies and Google Cloud SDK
RUN apt-get update && export DEBIAN_FRONTEND=noninteractive \
    && apt-get -y install --no-install-recommends \
    openjdk-21-jdk \
    imagemagick \
    rsync \
    apt-transport-https \
    ca-certificates \
    gnupg \
    curl \
    && echo "deb [signed-by=/usr/share/keyrings/cloud.google.gpg] https://packages.cloud.google.com/apt cloud-sdk main" | tee -a /etc/apt/sources.list.d/google-cloud-sdk.list \
    && curl https://packages.cloud.google.com/apt/doc/apt-key.gpg | gpg --dearmor -o /usr/share/keyrings/cloud.google.gpg \
    && apt-get update \
    && apt-get -y install google-cloud-cli \
    && apt-get clean -y && rm -rf /var/lib/apt/lists/*

# Install Playwright system dependencies
RUN npx playwright install-deps

# Install global npm packages
RUN npm install -g firebase-tools npm-run-all

# Switch to node user for subsequent operations
# Note: Cache, config, and credential directories are created via symlinks
# in postCreateCommand (see .devcontainer/scripts/post-create.sh)
USER node

# Set working directory to VS Code's default for container volumes
WORKDIR /workspaces
