# CPN IDE backend (Spring Boot + bundled 32-bit CPN simulator).
# Build from the repository root:  docker build -f docker/Dockerfile -t cpn-ide-backend .
# Note: rootless Podman mounts /dev/zero noexec, which breaks the 32-bit simulator
# (mmap EPERM). Use Docker, or remount /dev/zero with exec inside the container
# (as root: mount -o remount,bind,exec /dev/zero).
# The simulator daemon port (20001) is deliberately not EXPOSEd; the bundled cpnmld is
# patched by scripts/patch-cpnmld.mjs to listen on 127.0.0.1 only.

# ---- Stage 1: download the official installer and unpack the backend ----
FROM docker.io/library/debian:bookworm-slim AS fetch
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl innoextract nodejs npm zip unzip \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY scripts/fetch-cpn.sh scripts/build-sockshim.sh scripts/patch-cpnmld.mjs scripts/patch-ui.mjs scripts/
RUN scripts/fetch-cpn.sh

# ---- Stage 2: socket shim for the 32-bit simulator (see docker/sockshim.c, #119) ----
FROM docker.io/library/debian:bookworm-slim AS shim
RUN apt-get update \
 && apt-get install -y --no-install-recommends gcc gcc-multilib libc6-dev-i386 \
 && rm -rf /var/lib/apt/lists/*
COPY docker/sockshim.c /src/
# The i386 shim, plus an empty 64-bit library so 64-bit processes (java, sh, curl) preload quietly.
RUN gcc -m32 -shared -fPIC -O2 -Wall -Werror -o /src/libsockshim32.so /src/sockshim.c \
 && echo > /src/empty.c && gcc -shared -fPIC -o /src/libsockshim64.so /src/empty.c

# ---- Stage 3: runtime ----
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
# Docker >= 29 blocks the i386 socketcall(2) its glibc uses for sockets; the shim uses the direct syscalls instead.
# ld.so expands $PLATFORM per process: i686 (i386) for the simulator, x86_64 for everything else.
COPY --from=shim /src/libsockshim32.so shim/i686/libsockshim.so
COPY --from=shim /src/libsockshim32.so shim/i386/libsockshim.so
COPY --from=shim /src/libsockshim64.so shim/x86_64/libsockshim.so

# user.home is the data dir: the backend writes the simulator workspace under it.
ENV JAVA_OPTS="" \
    SERVER_PORT=8080 \
    LD_PRELOAD="/opt/cpn-ide/shim/\$PLATFORM/libsockshim.so"
VOLUME /data
USER cpn
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD curl -s -o /dev/null --max-time 4 "http://localhost:${SERVER_PORT}/" || exit 1

ENTRYPOINT ["sh", "-c", "exec java $JAVA_OPTS -Duser.home=/data -Dserver.port=${SERVER_PORT} -jar /opt/cpn-ide/cpn-ide-back-1.28-SNAPSHOT.jar"]
