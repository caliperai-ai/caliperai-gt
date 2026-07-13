"""
QA Review API Endpoints with RBAC protection.

Provides endpoints for:
- QA review session management
- Annotation reviews (approve/reject/flag)
- Comments on annotations
- AI-generated suggestions
"""
import uuid
from datetime import datetime
from typing import Annotated, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import func, and_, select

from app.core.database import get_db
from app.models.models import (
    QAReview,
    AnnotationReview,
    AnnotationComment,
    QASuggestion,
    Task,
    TaskStage,
    TaskStatus,
    User,
    Annotation,
    QAReviewStatus,
    QAReviewMode,
    ReviewVerdict,
    Permission,
)
from app.schemas.schemas import (
    QAReviewCreate,
    QAReviewUpdate,
    QAReviewComplete,
    QAReviewResponse,
    QAReviewSummary,
    AnnotationReviewCreate,
    AnnotationReviewUpdate,
    AnnotationReviewResponse,
    BulkAnnotationReviewCreate,
    BulkAnnotationReviewResponse,
    AnnotationCommentCreate,
    AnnotationCommentUpdate,
    AnnotationCommentResponse,
    ResolveCommentRequest,
    QASuggestionResponse,
    DismissSuggestionRequest,
    GenerateSuggestionsRequest,
    GenerateSuggestionsResponse,
    CreateManualSuggestionRequest,
    QATaskStats,
)
from app.services.rbac_service import (
    get_current_user,
    RequirePermissions,
)

router = APIRouter(prefix="/qa", tags=["qa"])



@router.post("/reviews", response_model=QAReviewResponse)
async def start_qa_review(
    review_data: QAReviewCreate,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.QA_REVIEW))],
    db: AsyncSession = Depends(get_db),
):
    """Start a new QA review session for a task. Requires QA_REVIEW permission."""
    result = await db.execute(select(Task).where(Task.id == review_data.task_id))
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    
    active_review_query = select(QAReview).where(
        QAReview.task_id == review_data.task_id,
        QAReview.status == QAReviewStatus.IN_PROGRESS.value,
    )
    if review_data.review_stage:
        active_review_query = active_review_query.where(
            QAReview.review_stage == review_data.review_stage
        )
    result = await db.execute(active_review_query)
    active_review = result.scalar_one_or_none()
    
    if active_review:
        raise HTTPException(
            status_code=400,
            detail="There is already an active QA review for this task"
        )
    
    review_stage = review_data.review_stage or task.stage
    
    mode_value = review_data.mode if isinstance(review_data.mode, str) else review_data.mode.value
    review = QAReview(
        id=uuid.uuid4(),
        task_id=review_data.task_id,
        reviewer_id=current_user.id,
        mode=mode_value,
        review_stage=review_stage,
        status=QAReviewStatus.IN_PROGRESS.value,
        started_at=datetime.utcnow(),
    )
    
    db.add(review)
    await db.flush()
    await db.refresh(review)
    
    previous_review_query = (
        select(QAReview)
        .where(
            QAReview.task_id == review_data.task_id,
            QAReview.status == QAReviewStatus.COMPLETED.value,
            QAReview.id != review.id,
        )
        .order_by(QAReview.completed_at.desc())
        .limit(1)
    )
    if review_stage:
        previous_review_query = previous_review_query.where(
            QAReview.review_stage == review_stage
        )
    result = await db.execute(previous_review_query)
    previous_review = result.scalar_one_or_none()
    
    if previous_review:
        result = await db.execute(
            select(AnnotationReview)
            .where(
                AnnotationReview.qa_review_id == previous_review.id,
                AnnotationReview.verdict == ReviewVerdict.APPROVED.value,
            )
        )
        approved_reviews = result.scalars().all()
        
        for old_review in approved_reviews:
            new_annotation_review = AnnotationReview(
                id=uuid.uuid4(),
                qa_review_id=review.id,
                annotation_id=old_review.annotation_id,
                annotation_table=old_review.annotation_table,
                verdict=old_review.verdict,
                issue_types=None,
                notes="Carried over from previous QA review",
                reviewed_at=old_review.reviewed_at,
            )
            db.add(new_annotation_review)
        
        await db.flush()
    
    return await _format_review_response(review, db)


@router.get("/reviews/{review_id}", response_model=QAReviewResponse)
async def get_qa_review(
    review_id: uuid.UUID,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.QA_ISSUES_READ))],
    db: AsyncSession = Depends(get_db),
):
    """Get a QA review session by ID. Requires QA_ISSUES_READ permission."""
    result = await db.execute(select(QAReview).where(QAReview.id == review_id))
    review = result.scalar_one_or_none()
    if not review:
        raise HTTPException(status_code=404, detail="QA review not found")
    
    return await _format_review_response(review, db)


@router.get("/tasks/{task_id}/reviews", response_model=List[QAReviewResponse])
async def get_task_reviews(
    task_id: uuid.UUID,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.QA_ISSUES_READ))],
    status: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
):
    """Get all QA reviews for a task. Requires QA_ISSUES_READ permission."""
    query = select(QAReview).where(QAReview.task_id == task_id)
    
    if status:
        query = query.where(QAReview.status == status)
    
    query = query.order_by(QAReview.created_at.desc())
    result = await db.execute(query)
    reviews = result.scalars().all()
    
    return [await _format_review_response(r, db) for r in reviews]


@router.get("/tasks/{task_id}/active-review", response_model=Optional[QAReviewResponse])
async def get_active_review(
    task_id: uuid.UUID,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.QA_ISSUES_READ))],
    db: AsyncSession = Depends(get_db),
    review_stage: Optional[str] = None,
):
    """Get the active QA review for a task, if any. Requires QA_ISSUES_READ permission.
    
    If review_stage is provided, only returns active reviews for that specific stage.
    This is important for separating QA reviews from Customer QA reviews.
    """
    query = select(QAReview).where(
        QAReview.task_id == task_id,
        QAReview.status == QAReviewStatus.IN_PROGRESS.value,
    )
    
    if review_stage:
        query = query.where(QAReview.review_stage == review_stage)
    
    result = await db.execute(query)
    review = result.scalar_one_or_none()
    
    if not review:
        return None
    
    return await _format_review_response(review, db)


@router.patch("/reviews/{review_id}", response_model=QAReviewResponse)
async def update_qa_review(
    review_id: uuid.UUID,
    update_data: QAReviewUpdate,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.QA_REVIEW))],
    db: AsyncSession = Depends(get_db),
):
    """Update a QA review session. Requires QA_REVIEW permission."""
    result = await db.execute(select(QAReview).where(QAReview.id == review_id))
    review = result.scalar_one_or_none()
    if not review:
        raise HTTPException(status_code=404, detail="QA review not found")
    
    if update_data.status:
        review.status = update_data.status if isinstance(update_data.status, str) else update_data.status.value
    if update_data.mode:
        review.mode = update_data.mode if isinstance(update_data.mode, str) else update_data.mode.value
    
    await db.flush()
    await db.refresh(review)
    
    return await _format_review_response(review, db)


@router.post("/reviews/{review_id}/complete", response_model=QAReviewResponse)
async def complete_qa_review(
    review_id: uuid.UUID,
    complete_data: QAReviewComplete,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.QA_REVIEW))],
    db: AsyncSession = Depends(get_db),
):
    """Complete a QA review session. Requires QA_REVIEW permission."""
    result = await db.execute(select(QAReview).where(QAReview.id == review_id))
    review = result.scalar_one_or_none()
    if not review:
        raise HTTPException(status_code=404, detail="QA review not found")
    
    task_result = await db.execute(select(Task).where(Task.id == review.task_id))
    task = task_result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    
    result = await db.execute(
        select(AnnotationReview).where(AnnotationReview.qa_review_id == review_id)
    )
    annotation_reviews = result.scalars().all()
    
    approved_count = sum(1 for ar in annotation_reviews if ar.verdict == ReviewVerdict.APPROVED.value)
    rejected_count = sum(1 for ar in annotation_reviews if ar.verdict == ReviewVerdict.REJECTED.value)
    flagged_count = sum(1 for ar in annotation_reviews if ar.verdict == ReviewVerdict.FLAGGED.value)
    pending_count = sum(1 for ar in annotation_reviews if ar.verdict is None or ar.verdict == ReviewVerdict.PENDING.value)
    
    summary = {
        "approved": approved_count,
        "rejected": rejected_count,
        "flagged": flagged_count,
        "pending": pending_count,
        "total_annotations": len(annotation_reviews),
    }
    
    review.status = QAReviewStatus.COMPLETED.value
    review.completed_at = datetime.utcnow()
    review.summary = summary
    
    current_stage = task.stage
    if current_stage == TaskStage.QA.value:
        if task.skip_customer_qa:
            task.stage = TaskStage.ACCEPTED.value
            task.status = TaskStatus.ACCEPTED.value
            summary["outcome"] = "accepted"
            summary["next_stage"] = TaskStage.ACCEPTED.value
        else:
            task.stage = TaskStage.CUSTOMER_QA.value
            task.status = TaskStatus.IN_PROGRESS.value
            summary["outcome"] = "accepted"
            summary["next_stage"] = TaskStage.CUSTOMER_QA.value
    elif current_stage == TaskStage.CUSTOMER_QA.value:
        task.stage = TaskStage.ACCEPTED.value
        task.status = TaskStatus.ACCEPTED.value
        summary["outcome"] = "accepted"
        summary["next_stage"] = TaskStage.ACCEPTED.value
    else:
        summary["outcome"] = "accepted"
        summary["next_stage"] = current_stage
    
    summary["approved"] = approved_count
    summary["rejected"] = rejected_count
    summary["flagged"] = flagged_count
    summary["pending"] = pending_count
    
    review.summary = summary
    
    await db.flush()
    await db.refresh(review)
    await db.refresh(task)
    
    return await _format_review_response(review, db)


@router.post("/reviews/{review_id}/pause", response_model=QAReviewResponse)
async def pause_qa_review(
    review_id: uuid.UUID,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.QA_REVIEW))],
    db: AsyncSession = Depends(get_db),
):
    """Pause a QA review session. Requires QA_REVIEW permission."""
    result = await db.execute(select(QAReview).where(QAReview.id == review_id))
    review = result.scalar_one_or_none()
    if not review:
        raise HTTPException(status_code=404, detail="QA review not found")
    
    review.status = QAReviewStatus.PAUSED.value
    await db.flush()
    await db.refresh(review)
    
    return await _format_review_response(review, db)


@router.post("/reviews/{review_id}/resume", response_model=QAReviewResponse)
async def resume_qa_review(
    review_id: uuid.UUID,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.QA_REVIEW))],
    db: AsyncSession = Depends(get_db),
):
    """Resume a paused QA review session. Requires QA_REVIEW permission."""
    result = await db.execute(select(QAReview).where(QAReview.id == review_id))
    review = result.scalar_one_or_none()
    if not review:
        raise HTTPException(status_code=404, detail="QA review not found")
    
    if review.status != QAReviewStatus.PAUSED.value:
        raise HTTPException(status_code=400, detail="Review is not paused")
    
    review.status = QAReviewStatus.IN_PROGRESS.value
    await db.flush()
    await db.refresh(review)
    
    return await _format_review_response(review, db)



@router.post("/reviews/{review_id}/annotations", response_model=AnnotationReviewResponse)
async def review_annotation(
    review_id: uuid.UUID,
    review_data: AnnotationReviewCreate,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.QA_ISSUES_CREATE))],
    db: AsyncSession = Depends(get_db),
):
    """Review a specific annotation. Requires QA_ISSUES_CREATE permission."""
    result = await db.execute(select(QAReview).where(QAReview.id == review_id))
    qa_review = result.scalar_one_or_none()
    if not qa_review:
        raise HTTPException(status_code=404, detail="QA review not found")
    
    result = await db.execute(
        select(AnnotationReview).where(
            AnnotationReview.qa_review_id == review_id,
            AnnotationReview.annotation_id == review_data.annotation_id,
        )
    )
    existing = result.scalar_one_or_none()
    
    if existing:
        verdict_value = review_data.verdict if isinstance(review_data.verdict, str) else review_data.verdict.value
        existing.verdict = verdict_value
        existing.issue_types = review_data.issue_types
        existing.notes = review_data.notes
        existing.reviewed_at = datetime.utcnow()
        if review_data.frame_id:
            existing.frame_id = review_data.frame_id
        if review_data.class_id:
            existing.class_id = review_data.class_id
        if review_data.location_x is not None:
            existing.location_x = review_data.location_x
        if review_data.location_y is not None:
            existing.location_y = review_data.location_y
        if review_data.location_z is not None:
            existing.location_z = review_data.location_z
        await db.flush()
        await db.refresh(existing)
        return await _format_annotation_review_response(existing, db)
    
    verdict_value = review_data.verdict if isinstance(review_data.verdict, str) else review_data.verdict.value
    annotation_review = AnnotationReview(
        id=uuid.uuid4(),
        qa_review_id=review_id,
        annotation_id=review_data.annotation_id,
        annotation_table=review_data.annotation_table,
        frame_id=review_data.frame_id,
        class_id=review_data.class_id,
        verdict=verdict_value,
        issue_types=review_data.issue_types,
        notes=review_data.notes,
        reviewed_at=datetime.utcnow(),
        location_x=review_data.location_x,
        location_y=review_data.location_y,
        location_z=review_data.location_z,
    )
    
    db.add(annotation_review)
    await db.flush()
    await db.refresh(annotation_review)
    
    return await _format_annotation_review_response(annotation_review, db)


@router.post("/reviews/{review_id}/annotations/bulk", response_model=BulkAnnotationReviewResponse)
async def bulk_review_annotations(
    review_id: uuid.UUID,
    bulk_data: BulkAnnotationReviewCreate,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.QA_ISSUES_CREATE))],
    db: AsyncSession = Depends(get_db),
):
    """Bulk review multiple annotations. Requires QA_ISSUES_CREATE permission."""
    result = await db.execute(select(QAReview).where(QAReview.id == review_id))
    qa_review = result.scalar_one_or_none()
    if not qa_review:
        raise HTTPException(status_code=404, detail="QA review not found")
    
    success_count = 0
    errors = []
    
    for i, review_data in enumerate(bulk_data.reviews):
        try:
            result = await db.execute(
                select(AnnotationReview).where(
                    AnnotationReview.qa_review_id == review_id,
                    AnnotationReview.annotation_id == review_data.annotation_id,
                )
            )
            existing = result.scalar_one_or_none()
            
            verdict_value = review_data.verdict if isinstance(review_data.verdict, str) else review_data.verdict.value
            
            if existing:
                existing.verdict = verdict_value
                existing.issue_types = review_data.issue_types
                existing.notes = review_data.notes
                existing.reviewed_at = datetime.utcnow()
            else:
                annotation_review = AnnotationReview(
                    id=uuid.uuid4(),
                    qa_review_id=review_id,
                    annotation_id=review_data.annotation_id,
                    annotation_table=review_data.annotation_table,
                    verdict=verdict_value,
                    issue_types=review_data.issue_types,
                    notes=review_data.notes,
                    reviewed_at=datetime.utcnow(),
                )
                db.add(annotation_review)
            
            success_count += 1
        except Exception as e:
            errors.append({"index": i, "error": str(e)})
    
    await db.flush()
    
    return BulkAnnotationReviewResponse(
        success_count=success_count,
        error_count=len(errors),
        errors=errors,
    )


@router.get("/reviews/{review_id}/annotations", response_model=List[AnnotationReviewResponse])
async def get_annotation_reviews(
    review_id: uuid.UUID,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.QA_ISSUES_READ))],
    verdict: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
):
    """Get all annotation reviews for a QA review session. Requires QA_ISSUES_READ permission."""
    query = select(AnnotationReview).where(AnnotationReview.qa_review_id == review_id)
    
    if verdict:
        query = query.where(AnnotationReview.verdict == verdict)
    
    result = await db.execute(query)
    reviews = result.scalars().all()
    return [await _format_annotation_review_response(r, db) for r in reviews]


@router.get("/annotations/{annotation_id}/review", response_model=Optional[AnnotationReviewResponse])
async def get_annotation_review_status(
    annotation_id: str,
    qa_review_id: uuid.UUID,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.QA_ISSUES_READ))],
    db: AsyncSession = Depends(get_db),
):
    """Get review status for a specific annotation. Requires QA_ISSUES_READ permission."""
    result = await db.execute(
        select(AnnotationReview).where(
            AnnotationReview.qa_review_id == qa_review_id,
            AnnotationReview.annotation_id == annotation_id,
        )
    )
    review = result.scalar_one_or_none()

    if not review:
        return None

    return await _format_annotation_review_response(review, db)


@router.post(
    "/annotation-reviews/{review_id}/resolve",
    response_model=AnnotationReviewResponse,
)
async def resolve_annotation_review(
    review_id: uuid.UUID,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.ANNOTATIONS_UPDATE))],
    db: AsyncSession = Depends(get_db),
):
    """Annotator marks an issue as fixed during a revision round.

    One-way: an issue cannot be unresolved through this endpoint. The
    task's Submit button on the frontend is blocked until every issue
    on the task has annotator_resolved=true.

    Requires ANNOTATIONS_UPDATE because it's the annotator (not the
    reviewer) acknowledging their fix.
    """
    review = await db.get(AnnotationReview, review_id)
    if not review:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Annotation review {review_id} not found",
        )

    if not review.annotator_resolved:
        review.annotator_resolved = True
        await db.flush()
        await db.refresh(review)

    return await _format_annotation_review_response(review, db)



@router.post("/comments", response_model=AnnotationCommentResponse)
async def create_comment(
    comment_data: AnnotationCommentCreate,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.QA_ISSUES_CREATE))],
    db: AsyncSession = Depends(get_db),
):
    """Create a comment on an annotation. Requires QA_ISSUES_CREATE permission."""
    comment = AnnotationComment(
        id=uuid.uuid4(),
        annotation_id=comment_data.annotation_id,
        annotation_table=comment_data.annotation_table,
        parent_id=comment_data.parent_id,
        content=comment_data.content,
    )
    
    db.add(comment)
    await db.flush()
    await db.refresh(comment)
    
    return await _format_comment_response(comment, db)


@router.get("/annotations/{annotation_id}/comments", response_model=List[AnnotationCommentResponse])
async def get_annotation_comments(
    annotation_id: str,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.QA_ISSUES_READ))],
    include_resolved: bool = False,
    db: AsyncSession = Depends(get_db),
):
    """Get comments for an annotation. Requires QA_ISSUES_READ permission."""
    query = select(AnnotationComment).where(
        AnnotationComment.annotation_id == annotation_id,
        AnnotationComment.parent_id.is_(None),
    )
    
    if not include_resolved:
        query = query.where(AnnotationComment.is_resolved == False)
    
    query = query.order_by(AnnotationComment.created_at.asc())
    result = await db.execute(query)
    comments = result.scalars().all()
    
    return [await _format_comment_response(c, db, include_replies=True) for c in comments]


@router.patch("/comments/{comment_id}", response_model=AnnotationCommentResponse)
async def update_comment(
    comment_id: uuid.UUID,
    update_data: AnnotationCommentUpdate,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.QA_ISSUES_CREATE))],
    db: AsyncSession = Depends(get_db),
):
    """Update a comment. Requires QA_ISSUES_CREATE permission."""
    result = await db.execute(
        select(AnnotationComment).where(AnnotationComment.id == comment_id)
    )
    comment = result.scalar_one_or_none()
    
    if not comment:
        raise HTTPException(status_code=404, detail="Comment not found")
    
    if update_data.content:
        comment.content = update_data.content
    
    await db.flush()
    await db.refresh(comment)
    
    return await _format_comment_response(comment, db)


@router.delete("/comments/{comment_id}")
async def delete_comment(
    comment_id: uuid.UUID,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.QA_ISSUES_CREATE))],
    db: AsyncSession = Depends(get_db),
):
    """Delete a comment. Requires QA_ISSUES_CREATE permission."""
    result = await db.execute(
        select(AnnotationComment).where(AnnotationComment.id == comment_id)
    )
    comment = result.scalar_one_or_none()
    
    if not comment:
        raise HTTPException(status_code=404, detail="Comment not found")
    
    await db.delete(comment)
    await db.flush()
    
    return {"message": "Comment deleted"}


@router.post("/comments/{comment_id}/resolve", response_model=AnnotationCommentResponse)
async def resolve_comment(
    comment_id: uuid.UUID,
    resolve_data: ResolveCommentRequest,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.QA_REVIEW))],
    db: AsyncSession = Depends(get_db),
):
    """Resolve or unresolve a comment thread. Requires QA_REVIEW permission."""
    result = await db.execute(
        select(AnnotationComment).where(AnnotationComment.id == comment_id)
    )
    comment = result.scalar_one_or_none()
    
    if not comment:
        raise HTTPException(status_code=404, detail="Comment not found")
    
    comment.is_resolved = resolve_data.is_resolved
    if resolve_data.is_resolved:
        comment.resolved_at = datetime.utcnow()
    else:
        comment.resolved_at = None
        comment.resolved_by = None
    
    await db.flush()
    await db.refresh(comment)
    
    return await _format_comment_response(comment, db)



@router.get("/tasks/{task_id}/suggestions", response_model=List[QASuggestionResponse])
async def get_task_suggestions(
    task_id: uuid.UUID,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.QA_ISSUES_READ))],
    include_dismissed: bool = False,
    severity: Optional[str] = None,
    suggestion_type: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
):
    """Get AI suggestions for a task. Requires QA_ISSUES_READ permission."""
    query = select(QASuggestion).where(QASuggestion.task_id == task_id)
    
    if not include_dismissed:
        query = query.where(QASuggestion.is_dismissed == False)
    
    if severity:
        query = query.where(QASuggestion.severity == severity)
    
    if suggestion_type:
        query = query.where(QASuggestion.suggestion_type == suggestion_type)
    
    result = await db.execute(query)
    suggestions = result.scalars().all()
    
    severity_order = {
        "critical": 0,
        "high": 1,
        "medium": 2,
        "low": 3,
    }
    suggestions = list(suggestions)
    suggestions.sort(key=lambda s: (severity_order.get(s.severity, 2), s.created_at))
    
    return [_format_suggestion_response(s) for s in suggestions]


@router.post("/suggestions/manual", response_model=QASuggestionResponse)
async def create_manual_suggestion(
    request: CreateManualSuggestionRequest,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.QA_REVIEW))],
    db: AsyncSession = Depends(get_db),
):
    """
    Create a manual QA suggestion (e.g., false negative flag).
    
    Used when QA reviewer identifies a missing annotation in the point cloud.
    Requires QA_REVIEW permission.
    """
    result = await db.execute(select(Task).where(Task.id == request.task_id))
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    
    details = request.details or {}
    if request.location:
        details["location"] = request.location
    if request.suggested_class:
        details["suggested_class"] = request.suggested_class
    details["created_by"] = str(current_user.id)
    details["created_by_username"] = current_user.username
    
    suggestion = QASuggestion(
        id=uuid.uuid4(),
        task_id=request.task_id,
        frame_id=str(request.frame_id),
        suggestion_type=request.suggestion_type.value if hasattr(request.suggestion_type, 'value') else request.suggestion_type,
        severity=request.severity or "high",
        message=request.message,
        details=details,
        is_dismissed=False,
    )
    
    db.add(suggestion)
    await db.commit()
    await db.refresh(suggestion)
    
    return _format_suggestion_response(suggestion)


@router.post("/suggestions/{suggestion_id}/dismiss", response_model=QASuggestionResponse)
async def dismiss_suggestion(
    suggestion_id: uuid.UUID,
    dismiss_data: DismissSuggestionRequest,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.QA_REVIEW))],
    db: AsyncSession = Depends(get_db),
):
    """Dismiss a QA suggestion. Requires QA_REVIEW permission."""
    result = await db.execute(
        select(QASuggestion).where(QASuggestion.id == suggestion_id)
    )
    suggestion = result.scalar_one_or_none()
    
    if not suggestion:
        raise HTTPException(status_code=404, detail="Suggestion not found")
    
    suggestion.is_dismissed = True
    suggestion.dismissed_at = datetime.utcnow()
    
    if dismiss_data.reason:
        details = suggestion.details or {}
        details["dismiss_reason"] = dismiss_data.reason
        suggestion.details = details
    
    await db.flush()
    await db.refresh(suggestion)
    
    return _format_suggestion_response(suggestion)


@router.delete("/suggestions/{suggestion_id}")
async def delete_suggestion(
    suggestion_id: uuid.UUID,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.QA_REVIEW))],
    db: AsyncSession = Depends(get_db),
):
    """Delete a suggestion. Requires QA_REVIEW permission."""
    result = await db.execute(
        select(QASuggestion).where(QASuggestion.id == suggestion_id)
    )
    suggestion = result.scalar_one_or_none()
    
    if not suggestion:
        raise HTTPException(status_code=404, detail="Suggestion not found")
    
    await db.delete(suggestion)
    await db.flush()
    
    return {"message": "Suggestion deleted"}



@router.get("/tasks/{task_id}/stats", response_model=QATaskStats)
async def get_task_qa_stats(
    task_id: uuid.UUID,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.QA_ISSUES_READ))],
    db: AsyncSession = Depends(get_db),
):
    """Get QA statistics for a task. Requires QA_ISSUES_READ permission."""
    result = await db.execute(
        select(QAReview).where(
            QAReview.task_id == task_id,
            QAReview.status == QAReviewStatus.IN_PROGRESS.value,
        )
    )
    active_review = result.scalar_one_or_none()
    
    result = await db.execute(
        select(func.count(Annotation.id)).where(Annotation.task_id == task_id)
    )
    total_annotations = result.scalar() or 0
    
    reviewed_count = 0
    approved_count = 0
    rejected_count = 0
    flagged_count = 0
    
    if active_review:
        result = await db.execute(
            select(AnnotationReview).where(AnnotationReview.qa_review_id == active_review.id)
        )
        reviews = result.scalars().all()
        
        reviewed_count = len([r for r in reviews if r.verdict])
        approved_count = len([r for r in reviews if r.verdict == ReviewVerdict.APPROVED.value])
        rejected_count = len([r for r in reviews if r.verdict == ReviewVerdict.REJECTED.value])
        flagged_count = len([r for r in reviews if r.verdict == ReviewVerdict.FLAGGED.value])
    
    result = await db.execute(
        select(func.count(QASuggestion.id)).where(
            QASuggestion.task_id == task_id,
            QASuggestion.is_dismissed == False,
        )
    )
    suggestions_count = result.scalar() or 0
    
    result = await db.execute(
        select(func.count(QASuggestion.id)).where(
            QASuggestion.task_id == task_id,
            QASuggestion.is_dismissed == True,
        )
    )
    suggestions_dismissed = result.scalar() or 0
    
    comment_count = 0
    unresolved_comments = 0
    
    pending_count = total_annotations - reviewed_count
    review_progress = (reviewed_count / total_annotations * 100) if total_annotations > 0 else 0
    
    return QATaskStats(
        task_id=task_id,
        total_annotations=total_annotations,
        reviewed_count=reviewed_count,
        pending_count=pending_count,
        approved_count=approved_count,
        rejected_count=rejected_count,
        flagged_count=flagged_count,
        suggestions_count=suggestions_count,
        suggestions_dismissed=suggestions_dismissed,
        comment_count=comment_count,
        unresolved_comments=unresolved_comments,
        review_progress_percent=round(review_progress, 1),
        has_active_review=active_review is not None,
        active_review_id=active_review.id if active_review else None,
    )



async def _format_review_response(
    review: QAReview,
    db: AsyncSession,
) -> QAReviewResponse:
    """Format a QAReview for response."""
    reviewer_name = None
    if review.reviewer_id:
        result = await db.execute(select(User).where(User.id == review.reviewer_id))
        reviewer = result.scalar_one_or_none()
        if reviewer:
            reviewer_name = reviewer.full_name or reviewer.username
    
    summary = None
    if review.summary:
        summary = QAReviewSummary(**review.summary)
    
    return QAReviewResponse(
        id=review.id,
        task_id=review.task_id,
        reviewer_id=review.reviewer_id,
        reviewer_name=reviewer_name,
        status=review.status,
        mode=review.mode,
        review_stage=review.review_stage,
        started_at=review.started_at,
        completed_at=review.completed_at,
        summary=summary,
        created_at=review.created_at,
        updated_at=review.updated_at,
    )


async def _format_annotation_review_response(
    review: AnnotationReview,
    db: AsyncSession,
) -> AnnotationReviewResponse:
    """Format an AnnotationReview for response, including frame_id and class_id from the annotation."""
    frame_id = review.frame_id if hasattr(review, 'frame_id') else None
    class_id = review.class_id if hasattr(review, 'class_id') else None
    
    if not frame_id or not class_id:
        try:
            result = await db.execute(
                select(Annotation).where(Annotation.id == review.annotation_id)
            )
            annotation = result.scalar_one_or_none()
            if annotation:
                frame_id = frame_id or annotation.frame_id
                class_id = class_id or annotation.class_id
        except Exception:
            pass
    
    return AnnotationReviewResponse(
        id=review.id,
        qa_review_id=review.qa_review_id,
        annotation_id=review.annotation_id,
        annotation_table=review.annotation_table,
        verdict=review.verdict,
        issue_types=review.issue_types,
        notes=review.notes,
        reviewed_at=review.reviewed_at,
        created_at=review.created_at,
        updated_at=review.updated_at,
        frame_id=frame_id,
        class_id=class_id,
        location_x=getattr(review, 'location_x', None),
        location_y=getattr(review, 'location_y', None),
        location_z=getattr(review, 'location_z', None),
        annotator_resolved=getattr(review, 'annotator_resolved', False),
    )


async def _format_comment_response(
    comment: AnnotationComment,
    db: AsyncSession,
    include_replies: bool = False,
) -> AnnotationCommentResponse:
    """Format an AnnotationComment for response."""
    user_name = None
    if comment.user_id:
        result = await db.execute(select(User).where(User.id == comment.user_id))
        user = result.scalar_one_or_none()
        if user:
            user_name = user.full_name or user.username
    
    replies = []
    if include_replies:
        result = await db.execute(
            select(AnnotationComment)
            .where(AnnotationComment.parent_id == comment.id)
            .order_by(AnnotationComment.created_at.asc())
        )
        reply_records = result.scalars().all()
        replies = [await _format_comment_response(r, db, include_replies=False) for r in reply_records]
    
    return AnnotationCommentResponse(
        id=comment.id,
        annotation_id=comment.annotation_id,
        annotation_table=comment.annotation_table,
        user_id=comment.user_id,
        user_name=user_name,
        parent_id=comment.parent_id,
        content=comment.content,
        is_resolved=comment.is_resolved,
        resolved_by=comment.resolved_by,
        resolved_at=comment.resolved_at,
        replies=replies,
        created_at=comment.created_at,
        updated_at=comment.updated_at,
    )


def _format_suggestion_response(
    suggestion: QASuggestion,
) -> QASuggestionResponse:
    """Format a QASuggestion for response."""
    return QASuggestionResponse(
        id=suggestion.id,
        task_id=suggestion.task_id,
        annotation_id=suggestion.annotation_id,
        annotation_table=suggestion.annotation_table,
        frame_id=suggestion.frame_id,
        suggestion_type=suggestion.suggestion_type,
        severity=suggestion.severity,
        message=suggestion.message,
        details=suggestion.details,
        is_dismissed=suggestion.is_dismissed,
        dismissed_by=suggestion.dismissed_by,
        dismissed_at=suggestion.dismissed_at,
        created_at=suggestion.created_at,
    )
