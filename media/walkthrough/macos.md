# macOS: use the Docker backend

The CPN simulator is a 32-bit binary and cannot run on macOS. Run the backend in Docker instead.

With Docker installed and running, use **CPN IDE: Start Docker Backend** (the button on this step). It starts the container and sets `cpnIde.backendUrl` for you.

Manual fallback:

```sh
docker run -p 8080:8080 ghcr.io/alefire99/cpn-ide-backend:latest
```

Then set **`cpnIde.backendUrl`** to `http://localhost:8080`.
