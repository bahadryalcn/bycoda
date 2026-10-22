FROM node:24-bookworm AS node
FROM rust:1-bookworm
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
    && npm install --global pnpm@12.8.2 \
    && apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      python3 build-essential curl file wget pkg-config libgtk-3-dev libssl-dev \
      libwebkit2gtk-4.1-dev libayatana-appindicator3-dev libxdo-dev librsvg2-dev \
      patchelf rpm xdg-utils desktop-file-utils libfuse2 ca-certificates \
    && apt-get clean
ENV PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false \
    CARGO_TARGET_DIR=/cache/target CARGO_BUILD_JOBS=2 \
    BYCODA_HOST_RUNTIME_CACHE=/cache/runtime APPIMAGE_EXTRACT_AND_RUN=1
COPY build-release-linux.py /opt/build-release-linux.py
ENTRYPOINT ["python3", "/opt/build-release-linux.py"]
