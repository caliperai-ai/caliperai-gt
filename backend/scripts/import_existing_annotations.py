#!/usr/bin/env python3
"""
Import annotations for an existing scene.
Usage: python import_existing_annotations.py <scene_id>
"""
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from app.db.session import AsyncSessionLocal
from app.models.scene import Scene
from app.models.task import Task
from app.api.v1.endpoints.import_data import import_scene_annotations
from sqlalchemy import select
from psycopg2.extras import NumericRange


async def import_annotations_for_scene(scene_id: str):
    """Import annotations for a specific scene."""
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(Scene).where(Scene.id == scene_id))
        scene = result.scalar_one_or_none()
        
        if not scene:
            print(f"Scene {scene_id} not found!")
            return
        
        print(f"Found scene: {scene.name} (ID: {scene.id})")
        print(f"Frame count: {scene.frame_count}")
        
        scene_dir = Path(scene.storage_paths.get("root"))
        if not scene_dir.exists():
            print(f"Scene directory not found: {scene_dir}")
            return
        
        print(f"Scene directory: {scene_dir}")
        
        annotations_dir = scene_dir / "annotations"
        if not annotations_dir.exists():
            print(f"No annotations folder found at: {annotations_dir}")
            return
        
        print(f"Annotations folder found: {annotations_dir}")
        
        result = await db.execute(
            select(Task).where(
                Task.scene_id == scene_id,
                Task.name.like("Imported annotations%")
            )
        )
        existing_task = result.scalar_one_or_none()
        
        if existing_task:
            print(f"Task already exists: {existing_task.name} (ID: {existing_task.id})")
            task = existing_task
        else:
            from app.models.user import User
            result = await db.execute(select(User).limit(1))
            user = result.scalar_one_or_none()
            
            if not user:
                print("No users found in database!")
                return
            
            task = Task(
                scene_id=scene.id,
                name=f"Imported annotations - {scene.name}",
                description="Automatically created task for imported annotations",
                assignee_id=user.id,
                frame_range=NumericRange(0, scene.frame_count, '[)') if scene.frame_count > 0 else NumericRange(0, 1, '[)'),
            )
            db.add(task)
            await db.flush()
            print(f"Created new task: {task.name} (ID: {task.id})")
        
        print("Importing annotations...")
        annotations_3d, annotations_2d = await import_scene_annotations(
            db=db,
            scene=scene,
            scene_dir=scene_dir,
            task=task,
        )
        
        await db.commit()
        
        print(f"✓ Import complete!")
        print(f"  - 3D annotations: {annotations_3d}")
        print(f"  - 2D annotations: {annotations_2d}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: python import_existing_annotations.py <scene_id>")
        sys.exit(1)
    
    scene_id = sys.argv[1]
    asyncio.run(import_annotations_for_scene(scene_id))
