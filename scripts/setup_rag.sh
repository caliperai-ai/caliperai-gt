#!/bin/bash
# Setup RAG - Pull embedding model and initialize knowledge base
# Run this after docker-compose up to ensure RAG is ready

set -e

echo "========================================"
echo "CaliperGT RAG Setup"
echo "========================================"

# Check if Ollama is running
echo ""
echo "1. Checking Ollama status..."
if ! docker exec anno-ollama ollama list &> /dev/null; then
    echo "ERROR: Ollama container not running. Start with: docker-compose up -d ollama"
    exit 1
fi
echo "   Ollama is running."

# Pull embedding model
echo ""
echo "2. Pulling embedding model (nomic-embed-text)..."
echo "   This may take a few minutes on first run..."
docker exec anno-ollama ollama pull nomic-embed-text

# Verify model
echo ""
echo "3. Verifying embedding model..."
if docker exec anno-ollama ollama list | grep -q "nomic-embed-text"; then
    echo "   ✓ nomic-embed-text is available"
else
    echo "   ERROR: Failed to pull embedding model"
    exit 1
fi

# Check pgvector extension
echo ""
echo "4. Verifying pgvector extension..."
PGVECTOR=$(docker exec anno-postgres psql -U postgres -d annotation_platform -tAc "SELECT 1 FROM pg_extension WHERE extname='vector';" 2>/dev/null || echo "0")
if [ "$PGVECTOR" = "1" ]; then
    echo "   ✓ pgvector extension is enabled"
else
    echo "   INFO: pgvector extension not yet enabled (will be enabled by migration)"
fi

# Run database migrations
echo ""
echo "5. Running database migrations..."
docker exec anno-backend alembic upgrade head

# Trigger knowledge base indexing
echo ""
echo "6. Triggering knowledge base indexing..."
echo "   This will happen automatically on backend restart."
echo "   You can also manually trigger via API: POST /api/v1/knowledge/reindex"

# Verify setup
echo ""
echo "7. Checking RAG status..."
sleep 2  # Wait for backend to finish startup

RAG_STATUS=$(curl -s http://localhost:8001/api/v1/knowledge/status -H "Authorization: Bearer YOUR_TOKEN" 2>/dev/null || echo '{"error": "API not accessible"}')
echo "   RAG Status: $RAG_STATUS"

echo ""
echo "========================================"
echo "RAG Setup Complete!"
echo "========================================"
echo ""
echo "Next steps:"
echo "1. The knowledge base will be indexed on next backend restart"
echo "2. Test by asking the chatbot about CaliperGT features"
echo "3. Use /api/v1/knowledge/search to debug retrieval"
echo ""
