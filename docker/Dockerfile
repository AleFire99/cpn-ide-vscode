# CPN IDE backend (Spring Boot + bundled 32-bit CPN simulator).
# Build from the repository root:  docker build -f docker/Dockerfile -t cpn-ide-backend .
# Note: rootless Podman mounts /dev/zero noexec, which breaks the 32-bit simulator
# (mmap EPERM). Use Docker, or remount /dev/zero with exec inside the container.

# ---- Stage 1: download the official installer and unpack the backend ----
FROM docker.io/library/debian:bookworm-slim AS fetch
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl innoextract nodejs npm \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY scripts/fetch-cpn.sh scripts/fetch-cpn.sh
RUN scripts/fetch-cpn.sh

# ---- Stage 2: runtime ----
FROM docker.io/library/eclipse-temurin:17-jre-jammy

LABEL org.opencontainers.image.title="cpn-ide-backend" \
      org.opencontainers.image.description="CPN IDE backend (Coloured Petri Nets simulator REST API)" \
      org.opencontainers.image.source="https://github.com/AleFire99/cpn-ide-vscode" \
      org.opencontainers.image.url="https://cpnide.org" \
      org.opencontainers.image.licenses="AGPL-3.0" \
      org.opencontainers.image.vendor="AleFire99"

# The CPN simulator bundled in the jar is a 32-bit i386 executable.
RUN apt-get update \
 && apt-get install -y --no-install-recommends libc6-i386 curl \
 && rm -rf /var/lib/apt/lists/* \
 && useradd --system --create-home --home-dir /data --shell /usr/sbin/nologin cpn

WORKDIR /opt/cpn-ide
COPY --from=fetch /src/resources/backend/cpn-ide-back-1.28-SNAPSHOT.jar /src/resources/backend/application.properties ./

# user.home is the data dir: the backend writes the simulator workspace under it.
ENV JAVA_OPTS="" \
    SERVER_PORT=8080
VOLUME /data
USER cpn
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD curl -s -o /dev/null --max-time 4 "http://localhost:${SERVER_PORT}/" || exit 1

ENTRYPOINT ["sh", "-c", "exec java $JAVA_OPTS -Duser.home=/data -Dserver.port=${SERVER_PORT} -jar /opt/cpn-ide/cpn-ide-back-1.28-SNAPSHOT.jar"]
