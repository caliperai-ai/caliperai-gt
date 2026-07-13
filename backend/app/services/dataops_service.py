"""
DataOps Service - Annotation Version Tracking and Stage Snapshots

This service provides:
1. Automatic annotation history tracking on CRUD operations
2. Stage snapshots when tasks transition between stages
3. Query interfaces for history and snapshots
4. Diff generation between versions
"""
import uuid
from datetime import datetime
from typing import Optional, List, Dict, Any
from sqlalchemy import select, func, and_, desc
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.models import (
    Annotation,
    AnnotationHistory,
    StageSnapshot,
    Task,
    AnnotationChangeType,
    User,
)


class DataOpsService:
    """Service for managing annotation history and stage snapshots."""
    
    def __init__(self, db: AsyncSession):
        self.db = db
    
    
    async def record_annotation_change(
        self,
        annotation: Annotation,
        change_type: AnnotationChangeType,
        task: Task,
        changed_by_id: Optional[uuid.UUID] = None,
        previous_data: Optional[Dict] = None,
    ) -> AnnotationHistory:
        """
        Record a change to an annotation in the history.
        
        Args:
            annotation: The annotation that changed
            change_type: Type of change (created, updated, deleted)
            task: The task containing the annotation
            changed_by_id: User who made the change
            previous_data: Previous annotation data (for updates/deletes)
        
        Returns:
            The created AnnotationHistory record
        """
        version = await self._get_next_version(annotation.id)
        
        annotation_data = {
            "id": str(annotation.id),
            "track_id": str(annotation.track_id) if annotation.track_id else None,
            "type": annotation.type,
            "class_name": annotation.class_name,
            "data": annotation.data,
            "confidence": annotation.confidence,
            "is_interpolated": annotation.is_interpolated,
            "attributes": annotation.attributes,
        }
        
        history = AnnotationHistory(
            annotation_id=annotation.id,
            task_id=task.id,
            frame_id=annotation.frame_id,
            change_type=change_type.value,
            annotation_data=annotation_data,
            previous_data=previous_data,
            task_stage=task.stage,
            task_status=task.status,
            changed_by_id=changed_by_id,
            version=version,
        )
        
        self.db.add(history)
        await self.db.flush()
        
        return history
    
    async def _get_next_version(self, annotation_id: uuid.UUID) -> int:
        """Get the next version number for an annotation."""
        result = await self.db.execute(
            select(func.max(AnnotationHistory.version))
            .where(AnnotationHistory.annotation_id == annotation_id)
        )
        max_version = result.scalar()
        return (max_version or 0) + 1
    
    async def get_annotation_history(
        self,
        annotation_id: uuid.UUID,
        limit: int = 50,
        offset: int = 0,
    ) -> List[AnnotationHistory]:
        """Get version history for a specific annotation."""
        result = await self.db.execute(
            select(AnnotationHistory)
            .where(AnnotationHistory.annotation_id == annotation_id)
            .order_by(desc(AnnotationHistory.created_at))
            .limit(limit)
            .offset(offset)
        )
        return list(result.scalars().all())
    
    async def get_task_annotation_history(
        self,
        task_id: uuid.UUID,
        change_type: Optional[str] = None,
        limit: int = 100,
        offset: int = 0,
    ) -> List[AnnotationHistory]:
        """Get all annotation history for a task."""
        query = select(AnnotationHistory).where(
            AnnotationHistory.task_id == task_id
        )
        
        if change_type:
            query = query.where(AnnotationHistory.change_type == change_type)
        
        query = query.order_by(desc(AnnotationHistory.created_at)).limit(limit).offset(offset)
        
        result = await self.db.execute(query)
        return list(result.scalars().all())
    
    async def get_task_history_count(
        self,
        task_id: uuid.UUID,
        change_type: Optional[str] = None,
    ) -> int:
        """Get total count of history entries for a task."""
        query = select(func.count(AnnotationHistory.id)).where(
            AnnotationHistory.task_id == task_id
        )
        
        if change_type:
            query = query.where(AnnotationHistory.change_type == change_type)
        
        result = await self.db.execute(query)
        return result.scalar() or 0
    
    async def get_history_by_stage(
        self,
        task_id: uuid.UUID,
        stage: str,
    ) -> List[AnnotationHistory]:
        """Get all annotation history entries made during a specific stage."""
        result = await self.db.execute(
            select(AnnotationHistory)
            .where(
                and_(
                    AnnotationHistory.task_id == task_id,
                    AnnotationHistory.task_stage == stage,
                )
            )
            .order_by(desc(AnnotationHistory.created_at))
        )
        return list(result.scalars().all())
    
    
    async def create_stage_snapshot(
        self,
        task: Task,
        from_stage: str,
        to_stage: str,
        from_status: str,
        to_status: str,
        triggered_by_id: Optional[uuid.UUID] = None,
        notes: Optional[str] = None,
    ) -> StageSnapshot:
        """
        Create a snapshot of all annotations when a task transitions stages.
        
        Args:
            task: The task transitioning
            from_stage: Previous stage
            to_stage: New stage
            from_status: Previous status
            to_status: New status
            triggered_by_id: User who triggered the transition
            notes: Optional notes about the transition
        
        Returns:
            The created StageSnapshot record
        """
        result = await self.db.execute(
            select(Annotation)
            .where(Annotation.task_id == task.id)
            .options(selectinload(Annotation.frame))
        )
        annotations = list(result.scalars().all())
        
        annotations_snapshot = []
        annotations_by_class: Dict[str, int] = {}
        annotations_by_type: Dict[str, int] = {}
        annotations_by_frame: Dict[str, int] = {}
        
        for ann in annotations:
            ann_data = {
                "id": str(ann.id),
                "track_id": str(ann.track_id) if ann.track_id else None,
                "frame_id": str(ann.frame_id),
                "type": ann.type,
                "class_name": ann.class_name,
                "data": ann.data,
                "confidence": ann.confidence,
                "is_interpolated": ann.is_interpolated,
                "attributes": ann.attributes,
            }
            annotations_snapshot.append(ann_data)
            
            class_name = ann.class_name or "unknown"
            annotations_by_class[class_name] = annotations_by_class.get(class_name, 0) + 1
            
            ann_type = ann.type
            annotations_by_type[ann_type] = annotations_by_type.get(ann_type, 0) + 1
            
            frame_key = str(ann.frame_id)
            annotations_by_frame[frame_key] = annotations_by_frame.get(frame_key, 0) + 1
        
        timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
        snapshot_name = f"{from_stage}_to_{to_stage}_{timestamp}"
        
        snapshot = StageSnapshot(
            task_id=task.id,
            from_stage=from_stage,
            to_stage=to_stage,
            from_status=from_status,
            to_status=to_status,
            snapshot_name=snapshot_name,
            total_annotations=len(annotations),
            annotations_by_class=annotations_by_class,
            annotations_by_type=annotations_by_type,
            annotations_by_frame=annotations_by_frame,
            annotations_snapshot={"annotations": annotations_snapshot},
            triggered_by_id=triggered_by_id,
            notes=notes,
        )
        
        self.db.add(snapshot)
        await self.db.flush()
        
        return snapshot
    
    async def get_task_snapshots(
        self,
        task_id: uuid.UUID,
        limit: int = 50,
        offset: int = 0,
    ) -> List[StageSnapshot]:
        """Get all snapshots for a task."""
        result = await self.db.execute(
            select(StageSnapshot)
            .where(StageSnapshot.task_id == task_id)
            .order_by(desc(StageSnapshot.created_at))
            .limit(limit)
            .offset(offset)
        )
        return list(result.scalars().all())
    
    async def get_snapshot(self, snapshot_id: uuid.UUID) -> Optional[StageSnapshot]:
        """Get a specific snapshot by ID."""
        result = await self.db.execute(
            select(StageSnapshot).where(StageSnapshot.id == snapshot_id)
        )
        return result.scalar_one_or_none()
    
    async def get_snapshot_count(self, task_id: uuid.UUID) -> int:
        """Get the total number of snapshots for a task."""
        result = await self.db.execute(
            select(func.count(StageSnapshot.id))
            .where(StageSnapshot.task_id == task_id)
        )
        return result.scalar() or 0
    
    
    async def get_task_dataops_stats(self, task_id: uuid.UUID) -> Dict[str, Any]:
        """Get aggregated DataOps statistics for a task."""
        history_counts = await self.db.execute(
            select(
                AnnotationHistory.change_type,
                func.count(AnnotationHistory.id)
            )
            .where(AnnotationHistory.task_id == task_id)
            .group_by(AnnotationHistory.change_type)
        )
        history_by_type = {row[0]: row[1] for row in history_counts.fetchall()}
        
        total_history = sum(history_by_type.values())
        
        snapshot_count = await self.get_snapshot_count(task_id)
        
        latest_snapshot = await self.db.execute(
            select(StageSnapshot)
            .where(StageSnapshot.task_id == task_id)
            .order_by(desc(StageSnapshot.created_at))
            .limit(1)
        )
        latest = latest_snapshot.scalar_one_or_none()
        
        return {
            "total_changes": total_history,
            "changes_by_type": history_by_type,
            "created_count": history_by_type.get("created", 0),
            "updated_count": history_by_type.get("updated", 0),
            "deleted_count": history_by_type.get("deleted", 0),
            "snapshot_count": snapshot_count,
            "latest_snapshot": {
                "id": str(latest.id),
                "name": latest.snapshot_name,
                "created_at": latest.created_at.isoformat(),
                "total_annotations": latest.total_annotations,
            } if latest else None,
        }
    
    async def get_dataset_dataops_stats(self, dataset_id: uuid.UUID) -> Dict[str, Any]:
        """Get aggregated DataOps statistics for a dataset."""
        from app.models.models import Scene
        
        task_ids_result = await self.db.execute(
            select(Task.id)
            .join(Scene)
            .where(Scene.dataset_id == dataset_id)
        )
        task_ids = [row[0] for row in task_ids_result.fetchall()]
        
        if not task_ids:
            return {
                "total_changes": 0,
                "changes_by_type": {},
                "total_snapshots": 0,
                "tasks_with_history": 0,
                "total_tasks": 0,
            }
        
        total_history = await self.db.execute(
            select(func.count(AnnotationHistory.id))
            .where(AnnotationHistory.task_id.in_(task_ids))
        )
        
        history_counts = await self.db.execute(
            select(
                AnnotationHistory.change_type,
                func.count(AnnotationHistory.id)
            )
            .where(AnnotationHistory.task_id.in_(task_ids))
            .group_by(AnnotationHistory.change_type)
        )
        history_by_type = {row[0]: row[1] for row in history_counts.fetchall()}
        
        snapshot_count = await self.db.execute(
            select(func.count(StageSnapshot.id))
            .where(StageSnapshot.task_id.in_(task_ids))
        )
        
        tasks_with_history = await self.db.execute(
            select(func.count(func.distinct(AnnotationHistory.task_id)))
            .where(AnnotationHistory.task_id.in_(task_ids))
        )
        
        return {
            "total_changes": total_history.scalar() or 0,
            "changes_by_type": history_by_type,
            "total_snapshots": snapshot_count.scalar() or 0,
            "tasks_with_history": tasks_with_history.scalar() or 0,
            "total_tasks": len(task_ids),
        }
    
    async def get_dataset_history(
        self,
        dataset_id: uuid.UUID,
        change_type: Optional[str] = None,
        limit: int = 100,
        offset: int = 0,
    ) -> List[AnnotationHistory]:
        """Get annotation history for all tasks in a dataset."""
        from app.models.models import Scene
        
        query = (
            select(AnnotationHistory)
            .join(Task)
            .join(Scene)
            .where(Scene.dataset_id == dataset_id)
        )
        
        if change_type:
            query = query.where(AnnotationHistory.change_type == change_type)
        
        query = query.order_by(desc(AnnotationHistory.created_at)).limit(limit).offset(offset)
        
        result = await self.db.execute(query)
        return list(result.scalars().all())
    
    async def get_dataset_snapshots(
        self,
        dataset_id: uuid.UUID,
        limit: int = 100,
        offset: int = 0,
    ) -> List[StageSnapshot]:
        """Get all snapshots for tasks in a dataset."""
        from app.models.models import Scene
        
        result = await self.db.execute(
            select(StageSnapshot)
            .join(Task)
            .join(Scene)
            .where(Scene.dataset_id == dataset_id)
            .order_by(desc(StageSnapshot.created_at))
            .limit(limit)
            .offset(offset)
        )
        return list(result.scalars().all())
    
    
    async def compare_snapshots(
        self,
        snapshot_id_1: uuid.UUID,
        snapshot_id_2: uuid.UUID,
    ) -> Dict[str, Any]:
        """
        Compare two snapshots and return the differences.
        
        Returns:
            Dict with added, removed, and modified annotations
        """
        snapshot1 = await self.get_snapshot(snapshot_id_1)
        snapshot2 = await self.get_snapshot(snapshot_id_2)
        
        if not snapshot1 or not snapshot2:
            return {"error": "One or both snapshots not found"}
        
        anns1 = {a["id"]: a for a in snapshot1.annotations_snapshot.get("annotations", [])}
        anns2 = {a["id"]: a for a in snapshot2.annotations_snapshot.get("annotations", [])}
        
        ids1 = set(anns1.keys())
        ids2 = set(anns2.keys())
        
        added = [anns2[id] for id in ids2 - ids1]
        removed = [anns1[id] for id in ids1 - ids2]
        
        modified = []
        for id in ids1 & ids2:
            if anns1[id] != anns2[id]:
                modified.append({
                    "id": id,
                    "before": anns1[id],
                    "after": anns2[id],
                })
        
        return {
            "snapshot_1": {
                "id": str(snapshot1.id),
                "name": snapshot1.snapshot_name,
                "created_at": snapshot1.created_at.isoformat(),
            },
            "snapshot_2": {
                "id": str(snapshot2.id),
                "name": snapshot2.snapshot_name,
                "created_at": snapshot2.created_at.isoformat(),
            },
            "added": added,
            "removed": removed,
            "modified": modified,
            "summary": {
                "added_count": len(added),
                "removed_count": len(removed),
                "modified_count": len(modified),
            },
        }


def get_dataops_service(db: AsyncSession) -> DataOpsService:
    return DataOpsService(db)
