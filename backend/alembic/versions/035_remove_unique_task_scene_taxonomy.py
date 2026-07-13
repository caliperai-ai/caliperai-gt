"""Remove unique constraint (scene_id, taxonomy_id) from tasks to allow splits

Revision ID: 035
Revises: 034
Create Date: 2026-05-20

Tasks can now have multiple rows per (scene, taxonomy) with different frame
ranges, enabling annotators to split a scene into sub-tasks after annotation.
"""
from typing import Sequence, Union
from alembic import op

revision: str = "035"
down_revision: Union[str, None] = "034"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_constraint("uq_task_scene_taxonomy", "tasks", type_="unique")


def downgrade() -> None:
    op.create_unique_constraint(
        "uq_task_scene_taxonomy",
        "tasks",
        ["scene_id", "taxonomy_id"],
    )
