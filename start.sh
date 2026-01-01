#!/bin/bash

# Function to show usage
show_help() {
    echo "Usage: ./start.sh [options]"
    echo ""
    echo "Options:"
    echo "  -s, --skip-build    Skip building the Docker image"
    echo "  -h, --help          Show this help message"
    echo ""
}

# Parse arguments
SKIP_BUILD=false

while [[ "$#" -gt 0 ]]; do
    case $1 in
        -s|--skip-build) SKIP_BUILD=true ;;
        -h|--help) show_help; exit 0 ;;
        *) echo "Unknown parameter passed: $1"; show_help; exit 1 ;;
    esac
    shift
done

# Stop and remove existing container if it exists
echo "Checking for existing container..."
if [ "$(docker ps -aq -f name=firecrawl-observer)" ]; then
    echo "Removing existing container..."
    docker stop firecrawl-observer 2>/dev/null || true
    docker rm firecrawl-observer 2>/dev/null || true
fi

# Build the image unless skipped
if [ "$SKIP_BUILD" = false ]; then
    echo "Building Docker image (using cache if no changes)..."
    docker build -f Dockerfile.dev \
      --build-arg NEXT_PUBLIC_CONVEX_URL=https://hidden-aardvark-287.convex.cloud \
      -t firecrawl-observer-dev .
else
    echo "Skipping Docker build..."
fi

# Run the container with auto-restart policy
echo "Starting new container..."
docker run -d \
  --name firecrawl-observer \
  --restart unless-stopped \
  -p 3000:3000 \
  -e NODE_ENV=production \
  firecrawl-observer-dev

echo "Container started successfully!"
