"""
Achievement Service - Automatic achievement awarding based on user activity.

This service checks for achievement criteria and awards achievements to users.
"""
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional, List
from uuid import UUID

from sqlalchemy import select, func, and_, cast, Text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.dialects.postgresql import insert

from app.models.models import (
    Achievement, AchievementType, Task, TaskStatus,
    Annotation, Annotation2D, Annotation3D, Annotation4D,
)

logger = logging.getLogger(__name__)


class AchievementService:
    """Service for checking and awarding achievements."""
    
    def __init__(self, db: AsyncSession):
        self.db = db
    
    async def check_and_award_achievements(self, user_id: UUID) -> List[Achievement]:
        """
        Check all achievement criteria for a user and award any earned achievements.
        Returns list of newly awarded achievements.
        """
        awarded = []
        
        checks = [
            (AchievementType.CENTURY_CLUB, self._check_century_club),
            (AchievementType.THOUSAND_LABELS, self._check_thousand_labels),
            (AchievementType.MILESTONE_5K, self._check_milestone_5k),
            (AchievementType.MARATHON_RUNNER, self._check_marathon_runner),
            (AchievementType.DEDICATED, self._check_dedicated),
            (AchievementType.QUALITY_CHAMPION, self._check_quality_champion),
            (AchievementType.ZERO_DEFECT, self._check_zero_defect),
        ]
        
        for achievement_type, check_func in checks:
            if await self._has_achievement(user_id, achievement_type):
                continue
            
            result = await check_func(user_id)
            if result["earned"]:
                achievement = await self._award_achievement(
                    user_id, 
                    achievement_type, 
                    result.get("metadata", {})
                )
                if achievement:
                    awarded.append(achievement)
        
        return awarded
    
    async def _has_achievement(self, user_id: UUID, achievement_type: AchievementType) -> bool:
        """Check if user already has this achievement."""
        result = await self.db.execute(
            select(Achievement.id).where(
                and_(
                    Achievement.user_id == user_id,
                    Achievement.achievement_type == achievement_type.value,
                )
            )
        )
        return result.scalar_one_or_none() is not None
    
    async def _award_achievement(
        self, 
        user_id: UUID, 
        achievement_type: AchievementType,
        metadata: dict
    ) -> Optional[Achievement]:
        """Award an achievement to a user."""
        try:
            stmt = insert(Achievement).values(
                user_id=user_id,
                achievement_type=achievement_type.value,
                earned_at=datetime.now(timezone.utc),
                achievement_metadata=metadata,
                is_seen=False,
            ).on_conflict_do_nothing(
                index_elements=['user_id', 'achievement_type']
            )
            
            await self.db.execute(stmt)
            await self.db.commit()
            
            result = await self.db.execute(
                select(Achievement).where(
                    and_(
                        Achievement.user_id == user_id,
                        Achievement.achievement_type == achievement_type.value,
                    )
                )
            )
            achievement = result.scalar_one_or_none()
            
            if achievement:
                logger.info(f"Awarded achievement {achievement_type.value} to user {user_id}")
            
            return achievement
        except Exception as e:
            logger.error(f"Error awarding achievement: {e}")
            await self.db.rollback()
            return None
    
    async def _count_user_annotations_today(self, user_id: UUID) -> int:
        """Count annotations created by user today."""
        today_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
        return await self._count_user_annotations_since(user_id, today_start)
    
    async def _count_user_annotations_total(self, user_id: UUID) -> int:
        """Count all annotations created by user."""
        return await self._count_user_annotations_since(user_id, datetime.min.replace(tzinfo=timezone.utc))
    
    async def _count_user_annotations_since(self, user_id: UUID, since: datetime) -> int:
        """Count manual annotations created by user since a given time."""
        total = 0

        for AnnotationModel in [Annotation, Annotation2D, Annotation3D, Annotation4D]:
            result = await self.db.execute(
                select(func.count(AnnotationModel.id))
                .join(Task, AnnotationModel.task_id == Task.id)
                .where(
                    and_(
                        Task.assignee_id == user_id,
                        AnnotationModel.created_at >= since,
                        cast(AnnotationModel.source, Text).like("manual%"),
                    )
                )
            )
            total += result.scalar() or 0

        return total
    
    async def _check_century_club(self, user_id: UUID) -> dict:
        """Check if user created 100 labels in a day."""
        count = await self._count_user_annotations_today(user_id)
        return {
            "earned": count >= 100,
            "metadata": {"labels_today": count}
        }
    
    async def _check_thousand_labels(self, user_id: UUID) -> dict:
        """Check if user has 1000 labels in a day."""
        count = await self._count_user_annotations_today(user_id)
        return {
            "earned": count >= 1000,
            "metadata": {"labels_today": count}
        }
    
    async def _check_milestone_5k(self, user_id: UUID) -> dict:
        """Check if user has 5000 labels in a day."""
        count = await self._count_user_annotations_today(user_id)
        return {
            "earned": count >= 5000,
            "metadata": {"labels_today": count}
        }
    
    async def _check_marathon_runner(self, user_id: UUID) -> dict:
        """Check if user has 10-day activity streak."""
        streak = await self._calculate_streak(user_id)
        return {
            "earned": streak >= 10,
            "metadata": {"streak_days": streak}
        }
    
    async def _check_dedicated(self, user_id: UUID) -> dict:
        """Check if user has 30-day activity streak."""
        streak = await self._calculate_streak(user_id)
        return {
            "earned": streak >= 30,
            "metadata": {"streak_days": streak}
        }
    
    async def _calculate_streak(self, user_id: UUID) -> int:
        """Calculate current activity streak for user."""
        now = datetime.now(timezone.utc)
        today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        
        streak = 0
        check_date = today_start
        
        for _ in range(365):
            day_start = check_date
            day_end = check_date + timedelta(days=1)
            
            has_labels = False
            for AnnotationModel in [Annotation, Annotation2D, Annotation3D, Annotation4D]:
                result = await self.db.execute(
                    select(func.count(AnnotationModel.id))
                    .join(Task, AnnotationModel.task_id == Task.id)
                    .where(
                        and_(
                            Task.assignee_id == user_id,
                            AnnotationModel.created_at >= day_start,
                            AnnotationModel.created_at < day_end,
                            cast(AnnotationModel.source, Text).like("manual%"),
                        )
                    )
                )
                if (result.scalar() or 0) > 0:
                    has_labels = True
                    break
            
            if has_labels:
                streak += 1
                check_date -= timedelta(days=1)
            else:
                break
        
        return streak
    
    async def _check_quality_champion(self, user_id: UUID) -> dict:
        """Check if user has 95%+ acceptance rate (min 10 reviewed tasks)."""
        result = await self.db.execute(
            select(
                func.count(Task.id).filter(Task.status == TaskStatus.ACCEPTED),
                func.count(Task.id).filter(Task.status.in_([TaskStatus.ACCEPTED, TaskStatus.REJECTED])),
            )
            .where(Task.assignee_id == user_id)
        )
        data = result.first()
        accepted = data[0] or 0
        total_reviewed = data[1] or 0
        
        if total_reviewed < 10:
            return {"earned": False}
        
        rate = accepted / total_reviewed * 100
        return {
            "earned": rate >= 95,
            "metadata": {"acceptance_rate": round(rate, 1), "total_reviewed": total_reviewed}
        }
    
    async def _check_zero_defect(self, user_id: UUID) -> dict:
        """Check if user has 50 first-time accepts (tasks accepted without revision)."""
        result = await self.db.execute(
            select(func.count(Task.id))
            .where(
                and_(
                    Task.assignee_id == user_id,
                    Task.status == TaskStatus.ACCEPTED,
                )
            )
        )
        accepted_count = result.scalar() or 0
        
        return {
            "earned": accepted_count >= 50,
            "metadata": {"accepted_tasks": accepted_count}
        }


async def check_achievements_for_user(db: AsyncSession, user_id: UUID) -> List[Achievement]:
    """
    Convenience function to check and award achievements for a user.
    Call this after annotation creation, task completion, etc.
    """
    service = AchievementService(db)
    return await service.check_and_award_achievements(user_id)
