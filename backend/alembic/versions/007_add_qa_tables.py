"""Add QA tables for review workflow

Revision ID: 007
Revises: 006
Create Date: 2024-12-28

Adds tables for QA review workflow:
- qa_reviews: QA session tracking
- annotation_reviews: Per-annotation review verdicts
- annotation_comments: Comment threads on annotations
- qa_suggestions: AI-generated suggestions for review
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = '007'
down_revision = '006'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # QA Reviews - Session tracking
    op.create_table(
        'qa_reviews',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('task_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('tasks.id', ondelete='CASCADE'), nullable=False),
        sa.Column('reviewer_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('status', sa.String(20), nullable=False, server_default='in_progress'),  # in_progress, completed, paused
        sa.Column('mode', sa.String(20), nullable=False, server_default='view_only'),  # view_only, edit, suggest
        sa.Column('started_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('completed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('summary', postgresql.JSONB, nullable=True),  # { approved: 45, rejected: 3, flagged: 2 }
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now(), nullable=False),
    )
    op.create_index('ix_qa_reviews_task_id', 'qa_reviews', ['task_id'])
    op.create_index('ix_qa_reviews_reviewer_id', 'qa_reviews', ['reviewer_id'])
    op.create_index('ix_qa_reviews_status', 'qa_reviews', ['status'])
    
    # Annotation Reviews - Per-annotation verdicts
    op.create_table(
        'annotation_reviews',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('qa_review_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('qa_reviews.id', ondelete='CASCADE'), nullable=False),
        sa.Column('annotation_id', sa.String(100), nullable=False),  # Can reference annotations or annotations_4d
        sa.Column('annotation_table', sa.String(50), nullable=False, server_default='annotations'),  # annotations, annotations_4d, annotations_2d
        sa.Column('verdict', sa.String(20), nullable=True),  # approved, rejected, flagged, pending
        sa.Column('issue_types', postgresql.ARRAY(sa.String(50)), nullable=True),  # ['box_too_loose', 'wrong_class']
        sa.Column('notes', sa.Text, nullable=True),
        sa.Column('reviewed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now(), nullable=False),
    )
    op.create_index('ix_annotation_reviews_qa_review_id', 'annotation_reviews', ['qa_review_id'])
    op.create_index('ix_annotation_reviews_annotation_id', 'annotation_reviews', ['annotation_id'])
    op.create_unique_constraint('uq_annotation_reviews_qa_annotation', 'annotation_reviews', ['qa_review_id', 'annotation_id'])
    
    # Annotation Comments - Threaded comments
    op.create_table(
        'annotation_comments',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('annotation_id', sa.String(100), nullable=False),
        sa.Column('annotation_table', sa.String(50), nullable=False, server_default='annotations'),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('parent_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('annotation_comments.id', ondelete='CASCADE'), nullable=True),
        sa.Column('content', sa.Text, nullable=False),
        sa.Column('is_resolved', sa.Boolean, nullable=False, server_default='false'),
        sa.Column('resolved_by', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('resolved_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now(), nullable=False),
    )
    op.create_index('ix_annotation_comments_annotation_id', 'annotation_comments', ['annotation_id'])
    op.create_index('ix_annotation_comments_user_id', 'annotation_comments', ['user_id'])
    op.create_index('ix_annotation_comments_parent_id', 'annotation_comments', ['parent_id'])
    
    # QA Suggestions - AI-generated suggestions
    op.create_table(
        'qa_suggestions',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('task_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('tasks.id', ondelete='CASCADE'), nullable=False),
        sa.Column('annotation_id', sa.String(100), nullable=True),  # Can be null for task-level suggestions
        sa.Column('annotation_table', sa.String(50), nullable=True),
        sa.Column('frame_id', sa.String(100), nullable=True),
        sa.Column('suggestion_type', sa.String(50), nullable=False),  # size_anomaly, position_jump, class_mismatch, etc.
        sa.Column('severity', sa.String(20), nullable=False, server_default='medium'),  # low, medium, high, critical
        sa.Column('message', sa.Text, nullable=False),
        sa.Column('details', postgresql.JSONB, nullable=True),  # { expected: 4.5, actual: 6.2, delta_percent: 38 }
        sa.Column('is_dismissed', sa.Boolean, nullable=False, server_default='false'),
        sa.Column('dismissed_by', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('dismissed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index('ix_qa_suggestions_task_id', 'qa_suggestions', ['task_id'])
    op.create_index('ix_qa_suggestions_annotation_id', 'qa_suggestions', ['annotation_id'])
    op.create_index('ix_qa_suggestions_severity', 'qa_suggestions', ['severity'])
    op.create_index('ix_qa_suggestions_is_dismissed', 'qa_suggestions', ['is_dismissed'])


def downgrade() -> None:
    op.drop_table('qa_suggestions')
    op.drop_table('annotation_comments')
    op.drop_table('annotation_reviews')
    op.drop_table('qa_reviews')
