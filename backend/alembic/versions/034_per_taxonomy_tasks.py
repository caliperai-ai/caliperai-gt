"""Per-taxonomy tasks: add taxonomy_id to tasks, migrate data, drop task_taxonomy_status

Revision ID: 034
Revises: 033
Create Date: 2026-05-19

Each task now belongs to exactly one taxonomy. Tasks are auto-created per
(scene × taxonomy) when a taxonomy is linked to a dataset. The old
task_taxonomy_status table is removed.

Migration strategy:
  1. Add nullable taxonomy_id column to tasks.
  2. For each existing (task, taxonomy_status) pair:
     - If the task has only one taxonomy_status: update taxonomy_id on the task,
       copy status/stage/assignee from the taxonomy_status row.
     - If the task has multiple taxonomy_status rows: keep/update the task for the
       first taxonomy, create new tasks for the remaining ones, and re-point
       annotations to the correct new task via annotation.taxonomy_id.
  3. Add unique constraint (scene_id, taxonomy_id).
  4. Drop task_taxonomy_status table.
"""
from typing import Sequence, Union
import uuid

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, INT4RANGE
from sqlalchemy import text


revision: str = "034"
down_revision: Union[str, None] = "033"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()

    # 1. Add taxonomy_id column (nullable to allow backfill)
    op.add_column(
        "tasks",
        sa.Column(
            "taxonomy_id",
            UUID(as_uuid=True),
            sa.ForeignKey("taxonomies.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_index("ix_tasks_taxonomy_id", "tasks", ["taxonomy_id"])

    # 2. Migrate existing data from task_taxonomy_status
    #    For each task, fetch its taxonomy_status rows ordered by creation time.
    tasks_with_statuses = conn.execute(text("""
        SELECT
            t.id            AS task_id,
            t.scene_id,
            t.name          AS task_name,
            t.frame_range,
            t.config,
            t.priority,
            t.deadline,
            t.context_buffer_before,
            t.context_buffer_after,
            ts.taxonomy_id,
            ts.status,
            ts.stage,
            ts.assignee_id,
            ts.assigned_at,
            ts.reviewer_id,
            ts.reviewed_at,
            ts.review_notes,
            ts.customer_reviewer_id,
            ts.customer_reviewed_at,
            ts.customer_review_notes,
            ts.skip_customer_qa,
            ts.revision_count,
            ts.started_at,
            ts.submitted_at,
            ROW_NUMBER() OVER (PARTITION BY t.id ORDER BY ts.task_id, ts.taxonomy_id) AS rn
        FROM tasks t
        JOIN task_taxonomy_status ts ON ts.task_id = t.id
        WHERE t.is_deleted = FALSE
        ORDER BY t.id, ts.taxonomy_id
    """)).fetchall()

    # Group by task_id
    from collections import defaultdict
    task_rows: dict = defaultdict(list)
    for row in tasks_with_statuses:
        task_rows[row.task_id].append(row)

    for task_id, rows in task_rows.items():
        first = rows[0]

        # Update the existing task with the first taxonomy's data
        conn.execute(text("""
            UPDATE tasks SET
                taxonomy_id             = :taxonomy_id,
                status                  = :status,
                stage                   = :stage,
                assignee_id             = :assignee_id,
                assigned_at             = :assigned_at,
                reviewer_id             = :reviewer_id,
                reviewed_at             = :reviewed_at,
                review_notes            = :review_notes,
                customer_reviewer_id    = :customer_reviewer_id,
                customer_reviewed_at    = :customer_reviewed_at,
                customer_review_notes   = :customer_review_notes,
                skip_customer_qa        = :skip_customer_qa,
                revision_count          = :revision_count,
                started_at              = :started_at,
                submitted_at            = :submitted_at
            WHERE id = :task_id
        """), {
            "task_id":                  first.task_id,
            "taxonomy_id":              first.taxonomy_id,
            "status":                   first.status,
            "stage":                    first.stage,
            "assignee_id":              first.assignee_id,
            "assigned_at":              first.assigned_at,
            "reviewer_id":              first.reviewer_id,
            "reviewed_at":              first.reviewed_at,
            "review_notes":             first.review_notes,
            "customer_reviewer_id":     first.customer_reviewer_id,
            "customer_reviewed_at":     first.customer_reviewed_at,
            "customer_review_notes":    first.customer_review_notes,
            "skip_customer_qa":         first.skip_customer_qa,
            "revision_count":           first.revision_count,
            "started_at":               first.started_at,
            "submitted_at":             first.submitted_at,
        })

        # For additional taxonomies (if any), create new tasks
        for extra in rows[1:]:
            new_task_id = uuid.uuid4()
            conn.execute(text("""
                INSERT INTO tasks (
                    id, scene_id, taxonomy_id, name, status, stage,
                    frame_range, context_buffer_before, context_buffer_after,
                    priority, deadline, config,
                    assignee_id, assigned_at,
                    reviewer_id, reviewed_at, review_notes,
                    customer_reviewer_id, customer_reviewed_at, customer_review_notes,
                    skip_customer_qa, revision_count,
                    started_at, submitted_at,
                    is_deleted, created_at, updated_at
                )
                SELECT
                    :new_id, scene_id, :taxonomy_id,
                    name || ' (' || (SELECT name FROM taxonomies WHERE id = :taxonomy_id) || ')',
                    :status, :stage,
                    frame_range, context_buffer_before, context_buffer_after,
                    priority, deadline, config,
                    :assignee_id, :assigned_at,
                    :reviewer_id, :reviewed_at, :review_notes,
                    :customer_reviewer_id, :customer_reviewed_at, :customer_review_notes,
                    :skip_customer_qa, :revision_count,
                    :started_at, :submitted_at,
                    FALSE, NOW(), NOW()
                FROM tasks WHERE id = :task_id
            """), {
                "new_id":                   new_task_id,
                "task_id":                  extra.task_id,
                "taxonomy_id":              extra.taxonomy_id,
                "status":                   extra.status,
                "stage":                    extra.stage,
                "assignee_id":              extra.assignee_id,
                "assigned_at":              extra.assigned_at,
                "reviewer_id":              extra.reviewer_id,
                "reviewed_at":              extra.reviewed_at,
                "review_notes":             extra.review_notes,
                "customer_reviewer_id":     extra.customer_reviewer_id,
                "customer_reviewed_at":     extra.customer_reviewed_at,
                "customer_review_notes":    extra.customer_review_notes,
                "skip_customer_qa":         extra.skip_customer_qa,
                "revision_count":           extra.revision_count,
                "started_at":               extra.started_at,
                "submitted_at":             extra.submitted_at,
            })

            # Re-point annotations that belong to this taxonomy to the new task
            for ann_table in ("annotations", "annotations_3d", "annotations_2d"):
                # Only tables that have both task_id and taxonomy_id
                has_both = conn.execute(text(f"""
                    SELECT COUNT(*) FROM information_schema.columns
                    WHERE table_name = '{ann_table}'
                    AND column_name IN ('task_id', 'taxonomy_id')
                """)).scalar()
                if has_both == 2:
                    conn.execute(text(f"""
                        UPDATE {ann_table}
                        SET task_id = :new_id
                        WHERE task_id = :old_id AND taxonomy_id = :taxonomy_id
                    """), {
                        "new_id":      new_task_id,
                        "old_id":      extra.task_id,
                        "taxonomy_id": extra.taxonomy_id,
                    })

    # 3. Add unique constraint on (scene_id, taxonomy_id)
    op.create_unique_constraint(
        "uq_task_scene_taxonomy",
        "tasks",
        ["scene_id", "taxonomy_id"],
    )

    # 4. Drop task_taxonomy_status table
    op.drop_table("task_taxonomy_status")


def downgrade() -> None:
    # Recreate task_taxonomy_status table
    op.create_table(
        "task_taxonomy_status",
        sa.Column("task_id", UUID(as_uuid=True), sa.ForeignKey("tasks.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("taxonomy_id", UUID(as_uuid=True), sa.ForeignKey("taxonomies.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("status", sa.String(50), nullable=False, server_default="pending"),
        sa.Column("stage", sa.String(50), nullable=False, server_default="annotation"),
        sa.Column("assignee_id", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("assigned_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("reviewer_id", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("review_notes", sa.Text, nullable=True),
        sa.Column("customer_reviewer_id", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("customer_reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("customer_review_notes", sa.Text, nullable=True),
        sa.Column("skip_customer_qa", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("revision_count", sa.Integer, nullable=False, server_default="0"),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.drop_constraint("uq_task_scene_taxonomy", "tasks", type_="unique")
    op.drop_index("ix_tasks_taxonomy_id", table_name="tasks")
    op.drop_column("tasks", "taxonomy_id")
