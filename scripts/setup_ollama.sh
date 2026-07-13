#!/bin/bash
# Setup script for Ollama LLM service
# This script pulls the default model and verifies the installation
#
# Usage:
#   ./scripts/setup_ollama.sh                                    # Development
#   ./scripts/setup_ollama.sh -f docker-compose.prod.yml         # Production CPU
#   ./scripts/setup_ollama.sh -f docker-compose.prod.yml -f docker-compose.prod.gpu.yml  # Production GPU

set -e

echo "=========================================="
echo "CaliperGT AI Chatbot - Ollama Setup"
echo "=========================================="
echo ""

# Parse compose file arguments
COMPOSE_FILES=""
while [[ $# -gt 0 ]]; do
    case $1 in
        -f|--file)
            COMPOSE_FILES="$COMPOSE_FILES -f $2"
            shift 2
            ;;
        *)
            shift
            ;;
    esac
done

# Default to docker-compose.yml if no files specified
if [ -z "$COMPOSE_FILES" ]; then
    COMPOSE_FILES="-f docker-compose.yml"
fi

# Default model
MODEL="${OLLAMA_MODEL:-mistral:7b-instruct}"

# Check if Ollama container is running
if ! docker ps | grep -q "anno-ollama"; then
    echo "Starting Ollama container..."
    docker compose $COMPOSE_FILES up -d ollama
    
    echo "Waiting for Ollama to be ready..."
    sleep 10
fi

# Wait for Ollama to be healthy
echo "Checking Ollama health..."
MAX_ATTEMPTS=30
ATTEMPT=0
while ! docker exec anno-ollama curl -sf http://localhost:11434/api/version > /dev/null 2>&1; do
    ATTEMPT=$((ATTEMPT + 1))
    if [ $ATTEMPT -ge $MAX_ATTEMPTS ]; then
        echo "ERROR: Ollama failed to start after ${MAX_ATTEMPTS} attempts"
        exit 1
    fi
    echo "  Waiting for Ollama... (attempt $ATTEMPT/$MAX_ATTEMPTS)"
    sleep 2
done
echo "✓ Ollama is running"

# Pull the model
echo ""
echo "Pulling model: $MODEL"
echo "This may take several minutes on first run..."
echo ""
docker exec anno-ollama ollama pull "$MODEL"
echo ""
echo "✓ Model pulled successfully"

# List available models
echo ""
echo "Available models:"
docker exec anno-ollama ollama list

# Test the model
echo ""
echo "Testing model with a simple prompt..."
RESPONSE=$(docker exec anno-ollama ollama run "$MODEL" "Say 'Hello, I am ready!' in exactly those words." 2>/dev/null | head -1)
echo "Response: $RESPONSE"

echo ""
echo "=========================================="
echo "✓ Ollama setup complete!"
echo "=========================================="
echo ""
echo "Model: $MODEL"
echo "API URL: http://localhost:11434"
echo ""
echo "You can now use the AI chatbot feature."
echo ""
echo "To pull additional models:"
echo "  docker exec anno-ollama ollama pull llama3.1:8b-instruct"
echo "  docker exec anno-ollama ollama pull phi3:medium"
echo ""
