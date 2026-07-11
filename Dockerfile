# Dummy Dockerfile to satisfy GitHub Actions example workflow build step
FROM alpine:3.18
RUN echo "Building mock carbon-aware deployment app"
CMD ["echo", "Mock app running carbon-aware deployment"]
