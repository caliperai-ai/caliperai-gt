"""Add semantic_segment to annotation_2d type constraint

Revision ID: 006
Revises: 005
Create Date: 2024-12-28

Adds 'semantic_segment' as a valid annotation type for 2D annotations.
This enables conversion of polygons to filled semantic segments.
"""
from alembic import op

# revision identifiers, used by Alembic.
revision = '006'
down_revision = '005'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Drop the old constraint
    op.drop_constraint('ck_annotation_2d_type', 'annotations_2d', type_='check')
    
    # Create new constraint with semantic_segment included
    op.create_check_constraint(
        'ck_annotation_2d_type',
        'annotations_2d',
        "type IN ('box', 'box2d', 'rotated_box', 'ellipse', 'polygon', 'polyline', 'points', 'keypoints', 'segmentation_2d', 'mask', 'semantic_segment')"
    )


def downgrade() -> None:
    # Drop the new constraint
    op.drop_constraint('ck_annotation_2d_type', 'annotations_2d', type_='check')
    
    # Restore old constraint without semantic_segment
    op.create_check_constraint(
        'ck_annotation_2d_type',
        'annotations_2d',
        "type IN ('box', 'box2d', 'rotated_box', 'ellipse', 'polygon', 'polyline', 'points', 'keypoints', 'segmentation_2d', 'mask')"
    )
