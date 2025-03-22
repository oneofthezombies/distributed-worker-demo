FROM mcr.microsoft.com/devcontainers/base:debian-12

ENV DEBIAN_FRONTEND=noninteractive

SHELL ["/bin/bash", "-c"]

RUN apt update && \
    apt install -y \
    curl \
    wget \
    git \
    # To open in a browser on the host
    xdg-utils \
    && apt clean && \
    rm -rf "/var/lib/apt/lists/*"

USER vscode
ENV HOME="/home/vscode"
RUN echo '' >> ~/.bashrc && \
    echo '################################################################################' >> ~/.bashrc && \
    echo '# Environment variables' >> ~/.bashrc && \
    echo '################################################################################' >> ~/.bashrc && \
    echo '' >> ~/.bashrc

RUN echo '# JavaScript' >> ~/.bashrc && \
    curl -fsSL https://deno.land/install.sh | sh -s v2.2.5 -y && \
    echo '' >> ~/.bashrc

RUN echo '# Aliases' >> ~/.bashrc && \
    echo 'alias ll="ls -alhF --color=auto"' >> ~/.bashrc && \
    echo '' >> ~/.bashrc

WORKDIR /work
