# macOS: use the Docker backend

The CPN simulator is a 32-bit binary and cannot run on macOS. Run the backend in Docker instead:

```sh
docker run -p 8080:8080 ghcr.io/alefire99/cpn-ide-backend:latest
```

Then set **`cpnIde.backendUrl`** to `http://localhost:8080`.
