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

ENV PATH="$HOME/.volta/bin:$PATH"
RUN echo '# JavaScript' >> ~/.bashrc && \
    curl https://get.volta.sh | bash && \
    volta install \
    node@22.13.0 \
    npm@11.0.0 \
    gitmoji-cli@9.5.0 \
    sort-package-json@3.0.0 \
    && echo '' >> ~/.bashrc

RUN echo '# Aliases' >> ~/.bashrc && \
    echo 'alias ll="ls -alhF --color=auto"' >> ~/.bashrc && \
    echo '' >> ~/.bashrc

WORKDIR /work
