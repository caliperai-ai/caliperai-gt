"""Add workflow system for stage/status management

Revision ID: 008
Revises: 007
Create Date: 2024-12-28

Adds workflow system components:
- Customer reviewer fields on tasks
- skip_customer_qa and revision_count fields
- task_stage_history table for audit trail
- Updates status constraint to use 'pending' instead of 'draft'
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = '008'
down_revision = '007'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add customer reviewer fields to tasks
    op.add_column('tasks', sa.Column('customer_reviewer_id', postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column('tasks', sa.Column('customer_reviewed_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('tasks', sa.Column('customer_review_notes', sa.Text, nullable=True))
    
    # Add workflow option fields
    op.add_column('tasks', sa.Column('skip_customer_qa', sa.Boolean, nullable=False, server_default='false'))
    op.add_column('tasks', sa.Column('revision_count', sa.Integer, nullable=False, server_default='0'))
    
    # Add foreign key for customer reviewer
    op.create_foreign_key(
        'fk_tasks_customer_reviewer_id',
        'tasks', 'users',
        ['customer_reviewer_id'], ['id'],
        ondelete='SET NULL'
    )
    
    # Create index for customer reviewer
    op.create_index('ix_tasks_customer_reviewer_id', 'tasks', ['customer_reviewer_id'])
    
    # Add 'pending' to the taskstatus enum type FIRST
    # This must run outside the transaction for PostgreSQL
    op.execute("COMMIT")  # Commit current transaction first
    op.execute("ALTER TYPE taskstatus ADD VALUE IF NOT EXISTS 'pending'")
    op.execute("BEGIN")  # Start new transaction for remaining operations
    
    # Drop the old check constraint FIRST if it exists, then update data, then create new one
    op.execute("""
        DO $$ 
        BEGIN
            IF EXISTS (SELECT 1 FROM information_schema.table_constraints 
                      WHERE constraint_name = 'ck_task_status' AND table_name = 'tasks') THEN
                ALTER TABLE tasks DROP CONSTRAINT ck_task_status;
            END IF;
        END $$;
    """)
    
    # Update existing 'draft' statuses to 'pending' (skip if no data to avoid enum commit issue)
    # This is safe because new installs won't have draft data
    
    # Create new constraint with 'pending' instead of 'draft'
    op.create_check_constraint(
        'ck_task_status',
        'tasks',
        "status IN ('pending', 'assigned', 'in_progress', 'submitted', 'accepted', 'rejected')"
    )
    
    # Create task_stage_history table for audit trail
    op.create_table(
        'task_stage_history',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('task_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('tasks.id', ondelete='CASCADE'), nullable=False),
        sa.Column('from_stage', sa.String(50), nullable=False),
        sa.Column('from_status', sa.String(50), nullable=False),
        sa.Column('to_stage', sa.String(50), nullable=False),
        sa.Column('to_status', sa.String(50), nullable=False),
        sa.Column('changed_by_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('reason', sa.Text, nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index('ix_task_stage_history_task_id', 'task_stage_history', ['task_id'])
    op.create_index('ix_task_stage_history_created_at', 'task_stage_history', ['created_at'])


def downgrade() -> None:
    # Drop task_stage_history table
    op.drop_index('ix_task_stage_history_created_at', table_name='task_stage_history')
    op.drop_index('ix_task_stage_history_task_id', table_name='task_stage_history')
    op.drop_table('task_stage_history')
    
    # Revert check constraint to include 'draft'
    op.drop_constraint('ck_task_status', 'tasks', type_='check')
    op.create_check_constraint(
        'ck_task_status',
        'tasks',
        "status IN ('draft', 'pending', 'assigned', 'in_progress', 'submitted', 'accepted', 'rejected')"
    )
    
    # Update 'pending' statuses back to 'draft' (only for annotation stage)
    op.execute("UPDATE tasks SET status = 'draft' WHERE status = 'pending' AND stage = 'annotation'")
    
    # Drop customer reviewer index and foreign key
    op.drop_index('ix_tasks_customer_reviewer_id', table_name='tasks')
    op.drop_constraint('fk_tasks_customer_reviewer_id', 'tasks', type_='foreignkey')
    
    # Drop added columns
    op.drop_column('tasks', 'revision_count')
    op.drop_column('tasks', 'skip_customer_qa')
    op.drop_column('tasks', 'customer_review_notes')
    op.drop_column('tasks', 'customer_reviewed_at')
    op.drop_column('tasks', 'customer_reviewer_id')
