"""Add AI chatbot tables

Revision ID: 024
Revises: 023
Create Date: 2026-02-16

This migration adds tables for the AI onboarding chatbot:
- chat_sessions: User chat sessions with the AI assistant
- chat_messages: Individual messages within sessions
- knowledge_chunks: Knowledge base chunks for RAG (future use)

Also enables pgvector extension for vector similarity search.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = '024'
down_revision = '023'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ===========================================================================
    # ENABLE PGVECTOR EXTENSION (for future RAG support)
    # ===========================================================================
    # Note: This requires superuser privileges. If it fails, run manually:
    # CREATE EXTENSION IF NOT EXISTS vector;
    # 
    # Skipping auto-creation to avoid transaction issues.
    # The extension is optional for Phase 1 (basic chat functionality works without it).
    # For RAG support (Phase 2), run manually in psql:
    #   docker exec -it anno-postgres psql -U postgres -d annotation_platform -c "CREATE EXTENSION IF NOT EXISTS vector;"
    
    # ===========================================================================
    # CHAT SESSIONS TABLE
    # ===========================================================================
    op.create_table(
        'chat_sessions',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), 
                  sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('title', sa.String(255), nullable=True),
        sa.Column('is_active', sa.Boolean, default=True, nullable=False),
        sa.Column('metadata', postgresql.JSONB, default=dict, nullable=True),
        
        # Timestamps
        sa.Column('created_at', sa.DateTime(timezone=True), 
                  server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), 
                  server_default=sa.func.now(), onupdate=sa.func.now(), nullable=False),
    )
    
    op.create_index('ix_chat_sessions_user_id', 'chat_sessions', ['user_id'])
    op.create_index('ix_chat_sessions_created_at', 'chat_sessions', ['created_at'])
    op.create_index('ix_chat_sessions_user_active', 'chat_sessions', ['user_id', 'is_active'])
    
    # ===========================================================================
    # CHAT MESSAGES TABLE
    # ===========================================================================
    op.create_table(
        'chat_messages',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('session_id', postgresql.UUID(as_uuid=True), 
                  sa.ForeignKey('chat_sessions.id', ondelete='CASCADE'), nullable=False),
        sa.Column('role', sa.String(20), nullable=False),
        sa.Column('content', sa.Text, nullable=False),
        
        # Context at time of message
        sa.Column('context', postgresql.JSONB, default=dict, nullable=True),
        
        # For assistant messages - tracking
        sa.Column('model_used', sa.String(100), nullable=True),
        sa.Column('tokens_used', sa.Integer, nullable=True),
        sa.Column('latency_ms', sa.Integer, nullable=True),
        
        # User feedback
        sa.Column('feedback', sa.String(20), nullable=True),
        
        # Timestamps
        sa.Column('created_at', sa.DateTime(timezone=True), 
                  server_default=sa.func.now(), nullable=False),
        
        # Constraints
        sa.CheckConstraint(
            "role IN ('user', 'assistant', 'system')",
            name='ck_chat_messages_valid_role'
        ),
        sa.CheckConstraint(
            "feedback IS NULL OR feedback IN ('helpful', 'not_helpful')",
            name='ck_chat_messages_valid_feedback'
        ),
    )
    
    op.create_index('ix_chat_messages_session_id', 'chat_messages', ['session_id'])
    op.create_index('ix_chat_messages_created_at', 'chat_messages', ['created_at'])
    op.create_index('ix_chat_messages_role', 'chat_messages', ['role'])
    
    # ===========================================================================
    # KNOWLEDGE CHUNKS TABLE (for RAG - Phase 2)
    # ===========================================================================
    op.create_table(
        'knowledge_chunks',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('source', sa.String(255), nullable=False),
        sa.Column('title', sa.String(255), nullable=True),
        sa.Column('content', sa.Text, nullable=False),
        
        # Vector embedding for semantic search (384 dims for all-MiniLM-L6-v2)
        # Using ARRAY for now; will upgrade to pgvector's vector type when available
        sa.Column('embedding', postgresql.ARRAY(sa.Float), nullable=True),
        
        # Metadata for filtering
        sa.Column('metadata', postgresql.JSONB, default=dict, nullable=True),
        
        # Timestamps
        sa.Column('created_at', sa.DateTime(timezone=True), 
                  server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), 
                  server_default=sa.func.now(), onupdate=sa.func.now(), nullable=False),
    )
    
    op.create_index('ix_knowledge_chunks_source', 'knowledge_chunks', ['source'])
    op.create_index('ix_knowledge_chunks_title', 'knowledge_chunks', ['title'])


def downgrade() -> None:
    # Drop tables in reverse order
    op.drop_table('knowledge_chunks')
    op.drop_table('chat_messages')
    op.drop_table('chat_sessions')
    
    # Note: Not dropping pgvector extension as other things may use it
