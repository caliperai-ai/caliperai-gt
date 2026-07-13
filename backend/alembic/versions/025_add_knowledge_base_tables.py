"""add_knowledge_base_tables

Revision ID: 025
Revises: 024
Create Date: 2025-01-17

Adds pgvector extension and knowledge_chunks table for RAG.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '025'
down_revision: Union[str, None] = '024'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Enable pgvector extension
    op.execute('CREATE EXTENSION IF NOT EXISTS vector')
    
    # Add additional columns to knowledge_chunks if they don't exist
    # (knowledge_chunks table was created in migration 024)
    op.execute("ALTER TABLE knowledge_chunks ADD COLUMN IF NOT EXISTS source_file VARCHAR(500)")
    op.execute("ALTER TABLE knowledge_chunks ADD COLUMN IF NOT EXISTS chunk_index INTEGER")
    op.execute("ALTER TABLE knowledge_chunks ADD COLUMN IF NOT EXISTS content_hash VARCHAR(64)")
    op.execute("ALTER TABLE knowledge_chunks ADD COLUMN IF NOT EXISTS file_hash VARCHAR(64)")
    op.execute("ALTER TABLE knowledge_chunks ADD COLUMN IF NOT EXISTS search_vector tsvector")
    
    # Add vector column with proper pgvector type if the existing ARRAY column can be replaced
    # For now just ensure the table is usable
    
    # Create indexes if not exist (use column names that exist in the table)
    op.execute('CREATE INDEX IF NOT EXISTS ix_knowledge_chunks_source ON knowledge_chunks (source)')
    op.execute('CREATE INDEX IF NOT EXISTS ix_knowledge_chunks_created_at ON knowledge_chunks (created_at)')
    
    # Create GIN index for full-text search if column exists
    op.execute('''
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM information_schema.columns 
                      WHERE table_name = 'knowledge_chunks' AND column_name = 'search_vector') THEN
                CREATE INDEX IF NOT EXISTS ix_knowledge_chunks_search_vector 
                ON knowledge_chunks USING GIN (search_vector);
            END IF;
        END $$;
    ''')
    
    # Create trigger to auto-update search_vector on insert/update
    op.execute('''
        CREATE OR REPLACE FUNCTION knowledge_chunks_search_trigger()
        RETURNS trigger AS $$
        BEGIN
            NEW.search_vector := to_tsvector('english', NEW.content);
            RETURN NEW;
        END
        $$ LANGUAGE plpgsql
    ''')
    
    op.execute('''
        CREATE TRIGGER trig_knowledge_chunks_search_vector
        BEFORE INSERT OR UPDATE ON knowledge_chunks
        FOR EACH ROW
        EXECUTE FUNCTION knowledge_chunks_search_trigger()
    ''')


def downgrade() -> None:
    # Drop trigger and function
    op.execute('DROP TRIGGER IF EXISTS trig_knowledge_chunks_search_vector ON knowledge_chunks')
    op.execute('DROP FUNCTION IF EXISTS knowledge_chunks_search_trigger()')
    
    # Drop table
    op.drop_table('knowledge_chunks')
    
    # Note: We don't drop the vector extension as other tables might use it
