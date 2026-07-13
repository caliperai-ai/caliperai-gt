"""
Pydantic schemas for API request/response validation.
Comprehensive validation for all annotation types and entities.
"""
from datetime import datetime
from enum import Enum
from typing import Optional, List, Dict, Any, Union, Literal
from uuid import UUID

from pydantic import (
    BaseModel,
    Field,
    ConfigDict,
    field_validator,
    model_validator,
    EmailStr,
)



class TaskStatus(str, Enum):
    PENDING = "pending"
    ASSIGNED = "assigned"
    IN_PROGRESS = "in_progress"
    SUBMITTED = "submitted"
    ACCEPTED = "accepted"
    REJECTED = "rejected"


class AnnotationType(str, Enum):
    CUBOID = "cuboid"
    BOX2D = "box2d"
    POLYLINE = "polyline"
    POLYGON = "polygon"
    KEYPOINTS = "keypoints"
    SEGMENTATION_3D = "segmentation_3d"
    SEGMENTATION_2D = "segmentation_2d"


class AnnotationSource(str, Enum):
    MANUAL = "manual"
    AUTO_INTERPOLATED = "auto_interpolated"
    AIRFLOW_MODEL_V1 = "airflow_model_v1"
    AIRFLOW_MODEL_V2 = "airflow_model_v2"
    IMPORTED = "imported"


class UserRole(str, Enum):
    """User roles for RBAC."""
    ADMIN = "admin"
    PROJECT_MANAGER = "project_manager"
    ANNOTATOR = "annotator"
    QA_REVIEWER = "qa_reviewer"
    CUSTOMER_QA = "customer_qa"


class TaxonomyAnnotationMode(str, Enum):
    """Annotation mode that a taxonomy supports."""
    FUSION_3D = "fusion_3d"
    ONLY_2D = "2d_only"
    SEGMENTATION_3D = "segmentation_3d"



class BaseSchema(BaseModel):
    """Base schema with common configuration."""
    model_config = ConfigDict(
        from_attributes=True,
        populate_by_name=True,
        use_enum_values=True,
    )


class TimestampSchema(BaseSchema):
    """Schema with timestamp fields."""
    created_at: datetime
    updated_at: datetime



class OrganizationRole(str, Enum):
    """Roles within an organization."""
    OWNER = "owner"
    ADMIN = "admin"
    MEMBER = "member"


class OrganizationBase(BaseSchema):
    """Base schema for organization."""
    name: str = Field(..., min_length=2, max_length=255)
    slug: str = Field(..., min_length=2, max_length=100, pattern=r'^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$')
    description: Optional[str] = None
    logo_url: Optional[str] = None


class OrganizationCreate(OrganizationBase):
    """Schema for creating an organization."""
    settings: Optional[Dict[str, Any]] = Field(default_factory=dict)


class OrganizationUpdate(BaseSchema):
    """Schema for updating an organization."""
    name: Optional[str] = Field(None, min_length=2, max_length=255)
    description: Optional[str] = None
    logo_url: Optional[str] = None
    settings: Optional[Dict[str, Any]] = None
    is_active: Optional[bool] = None


class OrganizationResponse(OrganizationBase, TimestampSchema):
    """Response schema for organization."""
    id: UUID
    settings: Dict[str, Any] = Field(default_factory=dict)
    is_active: bool


class OrganizationListResponse(BaseSchema):
    """List response for organizations."""
    organizations: List[OrganizationResponse]
    total: int



class OrganizationMemberBase(BaseSchema):
    """Base schema for organization membership."""
    role: OrganizationRole = Field(default=OrganizationRole.MEMBER)


class OrganizationMemberCreate(BaseSchema):
    """Schema for adding a member to an organization."""
    user_id: Optional[UUID] = None
    email: Optional[EmailStr] = None
    role: OrganizationRole = Field(default=OrganizationRole.MEMBER)
    
    @model_validator(mode='after')
    def check_user_or_email(self):
        if not self.user_id and not self.email:
            raise ValueError('Either user_id or email must be provided')
        return self


class OrganizationMemberUpdate(BaseSchema):
    """Schema for updating organization membership."""
    role: Optional[OrganizationRole] = None
    is_default: Optional[bool] = None


class OrganizationMemberResponse(OrganizationMemberBase, TimestampSchema):
    """Response schema for organization membership."""
    id: UUID
    organization_id: UUID
    user_id: UUID
    is_default: bool
    joined_at: datetime
    user: Optional["UserResponse"] = None


class OrganizationMemberListResponse(BaseSchema):
    """List response for organization members."""
    members: List[OrganizationMemberResponse]
    total: int


class OrganizationWithMembershipResponse(OrganizationResponse):
    """Organization response with the current user's membership info."""
    membership: Optional[OrganizationMemberResponse] = None


class UserOrganizationsResponse(BaseSchema):
    """Response with all organizations a user belongs to."""
    organizations: List[OrganizationWithMembershipResponse]
    default_organization: Optional[OrganizationResponse] = None



class UserBase(BaseSchema):
    email: EmailStr
    username: str = Field(..., min_length=3, max_length=100)
    full_name: Optional[str] = None
    role: UserRole = Field(default=UserRole.ANNOTATOR)


class UserCreate(UserBase):
    password: str = Field(..., min_length=8)


class UserUpdate(BaseSchema):
    email: Optional[EmailStr] = None
    username: Optional[str] = Field(None, min_length=3, max_length=100)
    full_name: Optional[str] = None
    role: Optional[UserRole] = None
    is_active: Optional[bool] = None


class UserResponse(UserBase, TimestampSchema):
    id: UUID
    is_active: bool
    is_superuser: bool


class UserWithPermissionsResponse(UserResponse):
    """User response including computed permissions."""
    permissions: List[str] = Field(default_factory=list)



class AttributeDefinition(BaseSchema):
    """Definition for a class attribute."""
    type: Literal["boolean", "string", "number", "enum"]
    default: Optional[Any] = None
    options: Optional[List[str]] = None
    required: bool = False
    description: Optional[str] = None
    mutable: bool = True


class SharedAttributeDefinition(BaseSchema):
    """
    Definition for a shared attribute that applies to multiple classes.
    These are defined at the taxonomy level and can be assigned to specific classes
    or all classes.
    """
    name: str = Field(..., min_length=1, max_length=100, description="Attribute name/id")
    type: Literal["boolean", "string", "number", "enum"]
    default: Optional[Any] = None
    options: Optional[List[str]] = None
    required: bool = False
    description: Optional[str] = None
    mutable: bool = True
    applies_to: List[str] = Field(
        default_factory=list,
        description="List of class IDs this attribute applies to. Empty list or ['__all__'] means all classes."
    )


class KeypointDefinition(BaseSchema):
    """Definition for a skeleton keypoint."""
    id: str
    name: str
    color: Optional[str] = None


class SkeletonDefinition(BaseSchema):
    """Definition for a skeleton structure."""
    keypoints: List[KeypointDefinition]
    bones: List[List[str]]


class ClassDefinition(BaseSchema):
    """Definition for an annotation class."""
    id: str
    name: str
    color: str = Field(..., pattern=r"^#[0-9A-Fa-f]{6}$")
    type: List[AnnotationType]
    attributes: Dict[str, AttributeDefinition] = Field(default_factory=dict)
    skeleton: Optional[str] = None
    description: Optional[str] = None
    default_dimensions: Optional[List[float]] = None
    single_click_placement: Optional[bool] = None


class AnnotationRules(BaseSchema):
    """Rules for annotations."""
    min_points_polyline: int = 2
    min_points_polygon: int = 3
    allow_overlapping_boxes: bool = False
    require_track_id: bool = True


class TaxonomyConfig(BaseSchema):
    """Complete taxonomy configuration for a dataset."""
    classes: List[ClassDefinition]
    skeletons: Dict[str, SkeletonDefinition] = Field(default_factory=dict)
    annotation_rules: AnnotationRules = Field(default_factory=AnnotationRules)
    shared_attributes: List[SharedAttributeDefinition] = Field(
        default_factory=list,
        description="Shared attributes that can apply to multiple classes"
    )



class CampaignStats(BaseSchema):
    """Aggregated statistics for a campaign."""
    total_datasets: int = 0
    total_scenes: int = 0
    total_tasks: int = 0
    completed_tasks: int = 0
    total_annotations: int = 0
    annotator_hours: float = 0.0


class CampaignConfig(BaseSchema):
    """Configuration for a campaign."""
    quality_thresholds: Dict[str, float] = Field(default_factory=dict)
    deadline: Optional[str] = None
    priority: str = "normal"
    tags: List[str] = Field(default_factory=list)


class CampaignBase(BaseSchema):
    name: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = None
    config: CampaignConfig = Field(default_factory=CampaignConfig)
    custom_metadata: Dict[str, Any] = Field(default_factory=dict)
    deadline: Optional[datetime] = None


class CampaignCreate(CampaignBase):
    organization_id: UUID = Field(..., description="Organization this campaign belongs to")


class CampaignUpdate(BaseSchema):
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    description: Optional[str] = None
    config: Optional[CampaignConfig] = None
    custom_metadata: Optional[Dict[str, Any]] = None
    deadline: Optional[datetime] = None


class CampaignResponse(CampaignBase, TimestampSchema):
    id: UUID
    organization_id: UUID
    stats: CampaignStats = Field(default_factory=CampaignStats)


class CampaignListResponse(BaseSchema):
    items: List[CampaignResponse]
    total: int
    page: int
    page_size: int



class TaxonomyBase(BaseSchema):
    """Base schema for Taxonomy entity."""
    name: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = None
    version: str = Field(default="1.0.0", max_length=50)
    annotation_mode: TaxonomyAnnotationMode = Field(
        default=TaxonomyAnnotationMode.FUSION_3D,
        description="Annotation mode: fusion_3d for 3D/4D/Fusion, 2d_only for pure 2D annotations"
    )
    classes: List[ClassDefinition] = Field(default_factory=list)
    skeletons: Dict[str, SkeletonDefinition] = Field(default_factory=dict)
    annotation_rules: AnnotationRules = Field(default_factory=AnnotationRules)
    shared_attributes: List[SharedAttributeDefinition] = Field(
        default_factory=list,
        description="Shared attributes that can apply to multiple classes"
    )


class TaxonomyCreate(TaxonomyBase):
    """Schema for creating a new taxonomy."""
    organization_id: UUID = Field(
        ..., 
        description="Organization this taxonomy belongs to."
    )


class TaxonomyUpdate(BaseSchema):
    """Schema for updating a taxonomy."""
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    description: Optional[str] = None
    version: Optional[str] = Field(None, max_length=50)
    annotation_mode: Optional[TaxonomyAnnotationMode] = None
    classes: Optional[List[ClassDefinition]] = None
    skeletons: Optional[Dict[str, SkeletonDefinition]] = None
    annotation_rules: Optional[AnnotationRules] = None
    shared_attributes: Optional[List[SharedAttributeDefinition]] = None


class TaxonomyResponse(TaxonomyBase, TimestampSchema):
    """Schema for taxonomy response."""
    id: UUID
    organization_id: UUID


class TaxonomyListResponse(BaseSchema):
    """Paginated list of taxonomies."""
    items: List[TaxonomyResponse]
    total: int
    page: int
    page_size: int


class TaxonomySummary(BaseSchema):
    """Brief taxonomy info for embedding in other responses."""
    id: UUID
    name: str
    version: str
    annotation_mode: TaxonomyAnnotationMode = TaxonomyAnnotationMode.FUSION_3D
    class_count: int = 0



class SensorConfig(BaseSchema):
    """Sensor configuration for a dataset."""
    lidar: Optional[Dict[str, Any]] = None
    cameras: List[Dict[str, Any]] = Field(default_factory=list)


class DatasetBase(BaseSchema):
    name: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = None
    taxonomy: TaxonomyConfig
    sensor_config: SensorConfig = Field(default_factory=SensorConfig)
    custom_metadata: Dict[str, Any] = Field(default_factory=dict)
    deadline: Optional[datetime] = None


class DatasetCreate(DatasetBase):
    campaign_id: UUID


class DatasetUpdate(BaseSchema):
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    description: Optional[str] = None
    taxonomy: Optional[TaxonomyConfig] = None
    sensor_config: Optional[SensorConfig] = None
    custom_metadata: Optional[Dict[str, Any]] = None
    deadline: Optional[datetime] = None


class DatasetResponse(DatasetBase, TimestampSchema):
    id: UUID
    campaign_id: UUID


class DatasetStats(BaseSchema):
    """Statistics for a dataset."""
    scene_count: int = 0
    total_frames: int = 0
    total_tasks: int = 0
    pending_tasks: int = 0
    in_progress_tasks: int = 0
    completed_tasks: int = 0


class DatasetDetailResponse(DatasetBase, TimestampSchema):
    """Complete dataset response with all related data for optimized loading."""
    id: UUID
    campaign_id: UUID
    taxonomies: List['TaxonomyResponse'] = Field(default_factory=list)
    scenes: List['SceneResponse'] = Field(default_factory=list)
    stats: DatasetStats = Field(default_factory=DatasetStats)



class RotationMatrix(BaseSchema):
    """3x3 rotation matrix."""
    matrix: List[List[float]] = Field(..., min_length=3, max_length=3)
    
    @field_validator("matrix")
    @classmethod
    def validate_rotation_matrix(cls, v):
        if len(v) != 3 or any(len(row) != 3 for row in v):
            raise ValueError("Rotation matrix must be 3x3")
        return v


class ExtrinsicCalibration(BaseSchema):
    """Extrinsic calibration (rotation + translation)."""
    rotation: List[List[float]]
    translation: List[float]
    
    @field_validator("translation")
    @classmethod
    def validate_translation(cls, v):
        if len(v) != 3:
            raise ValueError("Translation must have 3 components")
        return v


class IntrinsicCalibration(BaseSchema):
    """Intrinsic camera calibration."""
    fx: float = Field(..., gt=0)
    fy: float = Field(..., gt=0)
    cx: float = Field(..., gt=0)
    cy: float = Field(..., gt=0)
    distortion: Optional[List[float]] = None


class CameraCalibration(BaseSchema):
    """Complete camera calibration."""
    extrinsic: ExtrinsicCalibration
    intrinsic: IntrinsicCalibration


class SceneCalibration(BaseSchema):
    """All calibration data for a scene."""
    lidar_to_cameras: Dict[str, CameraCalibration]
    ego_to_lidar: Optional[ExtrinsicCalibration] = None


FlexibleCalibration = Union[Dict[str, Any], SceneCalibration]



class SceneMetadata(BaseSchema):
    """Metadata for a scene."""
    location: Optional[str] = None
    weather: Optional[str] = None
    time_of_day: Optional[str] = None
    recording_date: Optional[str] = None
    duration_seconds: Optional[float] = None
    ego_vehicle: Optional[str] = None


class StoragePaths(BaseSchema):
    """Storage paths for scene data."""
    lidar_base: str
    cameras: Dict[str, str] = Field(default_factory=dict)
    ego_poses: Optional[str] = None


class SceneBase(BaseSchema):
    name: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = None
    scene_metadata: SceneMetadata = Field(default_factory=SceneMetadata)
    frame_count: int = Field(..., gt=0)
    fps: float = Field(default=10.0, gt=0)
    calibration: SceneCalibration
    storage_paths: StoragePaths
    deadline: Optional[datetime] = None


class SceneCreate(SceneBase):
    dataset_id: UUID


class SceneUpdate(BaseSchema):
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    description: Optional[str] = None
    scene_metadata: Optional[SceneMetadata] = None
    calibration: Optional[SceneCalibration] = None
    deadline: Optional[datetime] = None
    selected_taxonomy_id: Optional[UUID] = None


class SceneResponse(TimestampSchema):
    """Response schema with flexible calibration to handle both old and new formats."""
    id: UUID
    dataset_id: UUID
    name: str
    description: Optional[str] = None
    scene_metadata: Dict[str, Any] = Field(default_factory=dict)
    frame_count: int
    fps: float
    calibration: Optional[Dict[str, Any]] = None
    storage_paths: Dict[str, Any] = Field(default_factory=dict)
    deadline: Optional[datetime] = None
    selected_taxonomy_id: Optional[UUID] = None
    tasks: List['TaskResponse'] = Field(default_factory=list)



class EgoPose(BaseSchema):
    """Ego vehicle pose at a frame."""
    position: List[float] = Field(..., min_length=3, max_length=3)
    rotation: List[float] = Field(..., min_length=4, max_length=4)
    velocity: Optional[List[float]] = None


class FrameFilePaths(BaseSchema):
    """File paths for frame data."""
    lidar: str
    cameras: Dict[str, str] = Field(default_factory=dict)


class FrameBase(BaseSchema):
    frame_index: int = Field(..., ge=0)
    timestamp: float = Field(..., ge=0)
    ego_pose: Optional[EgoPose] = None
    file_paths: FrameFilePaths


class FrameCreate(FrameBase):
    scene_id: UUID


class FrameResponse(FrameBase, TimestampSchema):
    id: UUID
    scene_id: UUID



class FrameRange(BaseSchema):
    """Frame range for a task."""
    start: int = Field(..., ge=0)
    end: int = Field(..., ge=0)
    
    @model_validator(mode="after")
    def validate_range(self):
        if self.end < self.start:
            raise ValueError("End frame must be >= start frame")
        return self


class TaskConfig(BaseSchema):
    """Task-specific configuration."""
    required_annotation_types: List[AnnotationType] = Field(default_factory=list)
    required_classes: List[str] = Field(default_factory=list)
    auto_annotation_enabled: bool = True
    quality_checks: List[str] = Field(default_factory=list)


class TaskBase(BaseSchema):
    name: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = None
    frame_range: FrameRange
    context_buffer_before: int = Field(default=5, ge=0)
    context_buffer_after: int = Field(default=5, ge=0)
    priority: int = Field(default=5, ge=1, le=10)
    deadline: Optional[datetime] = None
    config: TaskConfig = Field(default_factory=TaskConfig)
    stage: str = Field(default='annotation', description='Task workflow stage')


class TaskCreate(TaskBase):
    scene_id: UUID
    taxonomy_id: Optional[UUID] = Field(None, description='Taxonomy this task belongs to')
    assignee_id: Optional[UUID] = Field(None, description='Optional assignee ID - task will start as assigned if provided')


class TaskUpdate(BaseSchema):
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    description: Optional[str] = None
    priority: Optional[int] = Field(None, ge=1, le=10)
    deadline: Optional[datetime] = None
    config: Optional[TaskConfig] = None
    stage: Optional[str] = Field(None, description='Task workflow stage')
    revision_count: Optional[int] = Field(None, ge=0, description='Reset revision counter')
    total_time_seconds: Optional[int] = Field(None, ge=0, description='Accumulated annotation time in seconds')


class TaskAssignment(BaseSchema):
    """Task assignment request."""
    assignee_id: UUID


class TaskStatusUpdate(BaseSchema):
    """Task status update request."""
    status: TaskStatus
    review_notes: Optional[str] = None



class WorkflowTransitionRequest(BaseSchema):
    """Request to transition task status."""
    new_status: str = Field(..., description="New status to transition to")
    notes: Optional[str] = Field(None, description="Notes for the transition")


class WorkflowAssignRequest(BaseSchema):
    """Request to assign task to an annotator."""
    assignee_id: UUID


class WorkflowReviewerAssignRequest(BaseSchema):
    """Request to assign task to a QA reviewer."""
    reviewer_id: UUID


class WorkflowCustomerReviewerAssignRequest(BaseSchema):
    """Request to assign task to a customer reviewer."""
    customer_reviewer_id: UUID


class WorkflowQACompleteRequest(BaseSchema):
    """Request to complete QA review."""
    accepted: bool = Field(..., description="Whether the task passed QA")
    notes: Optional[str] = Field(None, description="Review notes")


class WorkflowSkipCustomerQARequest(BaseSchema):
    """Request to set skip_customer_qa flag."""
    skip: bool = Field(..., description="Whether to skip Customer QA")


class TaskStageHistoryResponse(BaseSchema):
    """Response for task stage history entry."""
    id: UUID
    task_id: UUID
    from_stage: str
    from_status: str
    to_stage: str
    to_status: str
    changed_by_id: Optional[UUID] = None
    reason: Optional[str] = None
    created_at: datetime


class TaskWorkflowInfo(BaseSchema):
    """Workflow information for a task."""
    id: UUID
    stage: str
    status: str
    valid_transitions: list[str] = Field(default_factory=list)
    can_submit: bool = False
    can_start_qa: bool = False
    can_start_customer_qa: bool = False
    skip_customer_qa: bool = False
    revision_count: int = 0


class TaskResponse(TaskBase, TimestampSchema):
    id: UUID
    scene_id: UUID
    taxonomy_id: Optional[UUID] = None
    taxonomy_name: Optional[str] = None
    taxonomy_annotation_mode: Optional[str] = None
    status: TaskStatus
    stage: str
    assignee_id: Optional[UUID] = None
    assigned_at: Optional[datetime] = None
    reviewer_id: Optional[UUID] = None
    reviewed_at: Optional[datetime] = None
    review_notes: Optional[str] = None
    customer_reviewer_id: Optional[UUID] = None
    customer_reviewed_at: Optional[datetime] = None
    customer_review_notes: Optional[str] = None
    skip_customer_qa: bool = False
    revision_count: int = 0
    started_at: Optional[datetime] = None
    submitted_at: Optional[datetime] = None
    total_time_seconds: int = 0

    @model_validator(mode="before")
    @classmethod
    def convert_frame_range(cls, data):
        """Convert PostgreSQL range to FrameRange dict."""
        if hasattr(data, '__dict__'):
            data_dict = {}
            for key in ['id', 'scene_id', 'taxonomy_id', 'name', 'description', 'status', 'stage',
                        'context_buffer_before', 'context_buffer_after',
                        'priority', 'deadline', 'config', 'assignee_id',
                        'assigned_at', 'reviewer_id', 'reviewed_at',
                        'review_notes', 'customer_reviewer_id', 'customer_reviewed_at',
                        'customer_review_notes', 'skip_customer_qa', 'revision_count',
                        'started_at', 'submitted_at',
                        'total_time_seconds', 'created_at', 'updated_at']:
                if hasattr(data, key):
                    data_dict[key] = getattr(data, key)

            if hasattr(data, 'frame_range') and data.frame_range is not None:
                fr = data.frame_range
                if hasattr(fr, 'lower') and hasattr(fr, 'upper'):
                    data_dict['frame_range'] = {'start': fr.lower, 'end': fr.upper - 1}
                else:
                    data_dict['frame_range'] = fr

            try:
                tax = getattr(data, 'taxonomy', None)
                if tax is not None:
                    data_dict['taxonomy_name'] = tax.name
                    data_dict['taxonomy_annotation_mode'] = tax.annotation_mode
            except Exception:
                pass

            return data_dict
        return data



class Point2D(BaseSchema):
    """2D point."""
    x: float
    y: float


class Point3D(BaseSchema):
    """3D point."""
    x: float
    y: float
    z: float


class BBox2D(BaseSchema):
    """2D bounding box."""
    x: float
    y: float
    width: float = Field(..., gt=0)
    height: float = Field(..., gt=0)


class Dimensions3D(BaseSchema):
    """3D dimensions for cuboid."""
    length: float = Field(..., gt=0)
    width: float = Field(..., gt=0)
    height: float = Field(..., gt=0)


class Rotation3D(BaseSchema):
    """3D rotation (yaw, pitch, roll in radians)."""
    yaw: float = 0.0
    pitch: float = 0.0
    roll: float = 0.0


class CuboidData(BaseSchema):
    """3D cuboid annotation data (9 DoF)."""
    center: Point3D
    dimensions: Dimensions3D
    rotation: Rotation3D
    confidence: float = Field(default=1.0, ge=0, le=1)


class Box2DData(BaseSchema):
    """2D bounding box annotation data."""
    camera_id: str
    bbox: BBox2D


class PolylineData(BaseSchema):
    """Polyline annotation data."""
    camera_id: str
    points: List[List[float]]
    is_closed: bool = False
    bezier: bool = False
    
    @field_validator("points")
    @classmethod
    def validate_points(cls, v):
        if len(v) < 2:
            raise ValueError("Polyline must have at least 2 points")
        for point in v:
            if len(point) != 2:
                raise ValueError("Each point must have [x, y] coordinates")
        return v


class PolygonData(BaseSchema):
    """Polygon annotation data."""
    camera_id: str
    points: List[List[float]]
    
    @field_validator("points")
    @classmethod
    def validate_points(cls, v):
        if len(v) < 3:
            raise ValueError("Polygon must have at least 3 points")
        return v


class Keypoint(BaseSchema):
    """Single keypoint with visibility."""
    x: float
    y: float
    visibility: int = Field(default=2, ge=0, le=2)


class KeypointsData(BaseSchema):
    """Keypoints annotation data."""
    camera_id: str
    skeleton_id: str
    keypoints: Dict[str, Keypoint]


class Segmentation3DData(BaseSchema):
    """3D semantic segmentation annotation data."""
    blob_url: Optional[str] = None
    compression: str = "zlib"
    point_count: int = Field(..., gt=0)
    class_mapping: Dict[str, str] = Field(default_factory=dict)


class Segmentation2DData(BaseSchema):
    """2D semantic segmentation annotation data."""
    camera_id: str
    mask_url: Optional[str] = None
    polygons: Optional[List[List[List[float]]]] = None


AnnotationData = Union[
    CuboidData,
    Box2DData,
    PolylineData,
    PolygonData,
    KeypointsData,
    Segmentation3DData,
    Segmentation2DData,
]



class AnnotationBase(BaseSchema):
    track_id: Optional[UUID] = None
    type: AnnotationType
    class_id: str
    data: Dict[str, Any]
    attributes: Dict[str, Any] = Field(default_factory=dict)
    source: AnnotationSource = AnnotationSource.MANUAL
    taxonomy_id: Optional[UUID] = None


class AnnotationCreate(AnnotationBase):
    task_id: UUID
    frame_id: UUID


class AnnotationUpdate(BaseSchema):
    track_id: Optional[UUID] = None
    class_id: Optional[str] = None
    data: Optional[Dict[str, Any]] = None
    attributes: Optional[Dict[str, Any]] = None


class AnnotationVerify(BaseSchema):
    """Verify an auto-annotation."""
    is_verified: bool = True
    modifications: Optional[Dict[str, Any]] = None


class AnnotationResponse(AnnotationBase, TimestampSchema):
    id: UUID
    task_id: UUID
    frame_id: UUID
    is_verified: bool
    verified_by: Optional[UUID] = None
    verified_at: Optional[datetime] = None



class BulkAnnotationCreate(BaseSchema):
    """Bulk create annotations."""
    annotations: List[AnnotationCreate]


class BulkAnnotationUpdate(BaseSchema):
    """Bulk update annotations."""
    updates: List[Dict[str, Any]]


class BulkOperationResponse(BaseSchema):
    """Response for bulk operations."""
    success_count: int
    error_count: int
    errors: List[Dict[str, Any]] = Field(default_factory=list)



class PaginationParams(BaseSchema):
    """Pagination parameters."""
    page: int = Field(default=1, ge=1)
    page_size: int = Field(default=20, ge=1, le=100)


class TaskFilters(BaseSchema):
    """Filter parameters for tasks."""
    status: Optional[TaskStatus] = None
    assignee_id: Optional[UUID] = None
    scene_id: Optional[UUID] = None
    priority_min: Optional[int] = None
    priority_max: Optional[int] = None


class AnnotationFilters(BaseSchema):
    """Filter parameters for annotations."""
    type: Optional[AnnotationType] = None
    class_id: Optional[str] = None
    source: Optional[AnnotationSource] = None
    is_verified: Optional[bool] = None
    track_id: Optional[UUID] = None



class Point3D(BaseSchema):
    """3D point coordinates."""
    x: float
    y: float
    z: float


class Rotation3D(BaseSchema):
    """3D rotation (Euler angles)."""
    yaw: float = 0.0
    pitch: float = 0.0
    roll: float = 0.0


class Dimensions3D(BaseSchema):
    """3D dimensions."""
    length: float
    width: float
    height: float


class CuboidWorldData(BaseSchema):
    """Cuboid in world coordinates."""
    center: Point3D
    dimensions: Dimensions3D
    rotation: Rotation3D
    origin_frame_id: Optional[UUID] = None
    origin_ego_pose: Optional[Dict[str, Any]] = None


class FrameCuboidData(BaseSchema):
    """Per-frame cuboid data in LiDAR coordinates."""
    center: Point3D
    rotation: Rotation3D
    is_keyframe: bool = False


class Annotation4DBase(BaseSchema):
    """Base schema for 4D annotations."""
    track_id: UUID
    type: str = "cuboid"
    class_id: str
    world_data: Dict[str, Any]
    frame_data: Dict[str, Any] = Field(default_factory=dict)
    frame_ids: List[UUID] = Field(default_factory=list)
    is_static: bool = True
    attributes: Dict[str, Any] = Field(default_factory=dict)
    source: str = "manual_4d"


class Annotation4DCreate(Annotation4DBase):
    """Create a new 4D annotation."""
    id: Optional[UUID] = None
    task_id: UUID


class Annotation4DUpdate(BaseSchema):
    """Update a 4D annotation."""
    world_data: Optional[Dict[str, Any]] = None
    frame_data: Optional[Dict[str, Any]] = None
    frame_ids: Optional[List[UUID]] = None
    attributes: Optional[Dict[str, Any]] = None
    class_id: Optional[str] = None


class Annotation4DUpdateBulkItem(BaseSchema):
    """Single item for bulk update of 4D annotations."""
    id: UUID
    world_data: Optional[Dict[str, Any]] = None
    frame_data: Optional[Dict[str, Any]] = None
    frame_ids: Optional[List[UUID]] = None
    attributes: Optional[Dict[str, Any]] = None
    class_id: Optional[str] = None


class BulkAnnotation4DUpdate(BaseSchema):
    """Bulk update 4D annotations."""
    annotations: List[Annotation4DUpdateBulkItem]


class BulkAnnotation4DDelete(BaseSchema):
    """Bulk delete 4D annotations."""
    annotation_ids: List[UUID]


class Annotation4DResponse(Annotation4DBase, TimestampSchema):
    """Response for a 4D annotation."""
    id: UUID
    task_id: UUID
    is_migrated: bool
    migrated_at: Optional[datetime] = None


class Annotation4DMigrateRequest(BaseSchema):
    """Request to migrate 4D annotations to regular 3D annotations."""
    annotation_4d_ids: Optional[List[UUID]] = None


class Annotation4DMigrateResponse(BaseSchema):
    """Response for 4D to 3D migration."""
    migrated_count: int
    created_annotations: List[UUID]
    errors: List[Dict[str, Any]] = Field(default_factory=list)



class Annotation3DBase(BaseSchema):
    """Base schema for 3D LiDAR annotations."""
    track_id: Optional[UUID] = None
    type: str = "cuboid"
    class_id: str
    taxonomy_id: Optional[UUID] = None
    data: Dict[str, Any]
    attributes: Dict[str, Any] = Field(default_factory=dict)
    source: str = "manual_3d"
    is_keyframe: bool = False
    is_static: bool = False


class Annotation3DCreate(Annotation3DBase):
    """Create a 3D annotation."""
    id: Optional[UUID] = None
    task_id: UUID
    frame_id: UUID


class Annotation3DUpdate(BaseSchema):
    """Update a 3D annotation."""
    track_id: Optional[UUID] = None
    class_id: Optional[str] = None
    taxonomy_id: Optional[UUID] = None
    data: Optional[Dict[str, Any]] = None
    attributes: Optional[Dict[str, Any]] = None
    is_keyframe: Optional[bool] = None


class Annotation3DUpdateBulkItem(BaseSchema):
    """Single item for bulk update."""
    id: UUID
    track_id: Optional[UUID] = None
    class_id: Optional[str] = None
    taxonomy_id: Optional[UUID] = None
    data: Optional[Dict[str, Any]] = None
    attributes: Optional[Dict[str, Any]] = None
    is_keyframe: Optional[bool] = None
    is_static: Optional[bool] = None


class BulkAnnotation3DUpdate(BaseSchema):
    """Bulk update 3D annotations."""
    annotations: List[Annotation3DUpdateBulkItem]


class BulkAnnotation3DDelete(BaseSchema):
    """Bulk delete 3D annotations."""
    annotation_ids: List[UUID]


class TrackWideUpdate3D(BaseSchema):
    """Update all annotations in a track with specified fields."""
    class_id: Optional[str] = None
    attributes: Optional[Dict[str, Any]] = None
    dimensions: Optional[Dict[str, float]] = None
    is_static: Optional[bool] = None


class Annotation3DResponse(Annotation3DBase, TimestampSchema):
    """Response for a 3D annotation."""
    id: UUID
    task_id: UUID
    frame_id: UUID
    taxonomy_id: Optional[UUID] = None
    is_migrated_to_fusion: bool
    migrated_at: Optional[datetime] = None
    fusion_annotation_id: Optional[UUID] = None
    is_verified: bool
    is_keyframe: bool = False
    is_static: bool = False


class Annotation2DProjection(BaseSchema):
    """2D projection data for a camera."""
    bbox: Optional[BBox2D] = None
    visibility: float = Field(default=1.0, ge=0, le=1)
    occlusion: float = Field(default=0.0, ge=0, le=1)
    truncation: float = Field(default=0.0, ge=0, le=1)
    verified: bool = False


class AnnotationFusionBase(BaseSchema):
    """Base schema for Fusion annotations (3D + 2D combined)."""
    track_id: Optional[UUID] = None
    type: str = "cuboid_fusion"
    class_id: str
    data_3d: Dict[str, Any]
    data_2d: Dict[str, Annotation2DProjection] = Field(default_factory=dict)
    attributes: Dict[str, Any] = Field(default_factory=dict)
    source: str = "manual_fusion"


class AnnotationFusionCreate(AnnotationFusionBase):
    """Create a Fusion annotation."""
    id: Optional[UUID] = None
    task_id: UUID
    frame_id: UUID
    source_3d_annotation_id: Optional[UUID] = None


class AnnotationFusionUpdate(BaseSchema):
    """Update a Fusion annotation."""
    track_id: Optional[UUID] = None
    class_id: Optional[str] = None
    data_3d: Optional[Dict[str, Any]] = None
    data_2d: Optional[Dict[str, Any]] = None
    attributes: Optional[Dict[str, Any]] = None


class AnnotationFusionResponse(AnnotationFusionBase, TimestampSchema):
    """Response for a Fusion annotation."""
    id: UUID
    task_id: UUID
    frame_id: UUID
    source_3d_annotation_id: Optional[UUID] = None
    is_verified: bool


class Annotation2DBase(BaseSchema):
    """Base schema for 2D camera annotations."""
    camera_id: str
    track_id: Optional[UUID] = None
    type: str
    class_id: str
    taxonomy_id: Optional[UUID] = None
    data: Dict[str, Any]
    attributes: Dict[str, Any] = Field(default_factory=dict)
    source: str = "manual_2d"


class Annotation2DCreate(Annotation2DBase):
    """Create a 2D annotation."""
    id: Optional[UUID] = None
    task_id: UUID
    frame_id: UUID


class Annotation2DUpdate(BaseSchema):
    """Update a 2D annotation."""
    track_id: Optional[UUID] = None
    class_id: Optional[str] = None
    data: Optional[Dict[str, Any]] = None
    attributes: Optional[Dict[str, Any]] = None


class Annotation2DUpdateBulkItem(BaseSchema):
    """Single item for bulk update."""
    id: UUID
    track_id: Optional[UUID] = None
    class_id: Optional[str] = None
    data: Optional[Dict[str, Any]] = None
    attributes: Optional[Dict[str, Any]] = None


class BulkAnnotation2DUpdate(BaseSchema):
    """Bulk update 2D annotations."""
    annotations: List[Annotation2DUpdateBulkItem]


class BulkAnnotation2DDelete(BaseSchema):
    """Bulk delete 2D annotations."""
    annotation_ids: List[UUID]


class TrackWideUpdate2D(BaseSchema):
    """Update all 2D annotations in a track with specified fields."""
    class_id: Optional[str] = None
    attributes: Optional[Dict[str, Any]] = None


class Annotation2DResponse(Annotation2DBase, TimestampSchema):
    """Response for a 2D annotation."""
    id: UUID
    task_id: UUID
    frame_id: UUID
    is_verified: bool


class Track2DBase(BaseSchema):
    """Base schema for 2D tracks."""
    camera_id: str
    class_id: str
    name: Optional[str] = None
    color: Optional[str] = None
    start_frame_index: Optional[int] = None
    end_frame_index: Optional[int] = None
    is_interpolated: bool = False
    is_complete: bool = False
    attributes: Dict[str, Any] = Field(default_factory=dict)


class Track2DCreate(Track2DBase):
    """Create a 2D track."""
    id: Optional[UUID] = None
    task_id: UUID


class Track2DUpdate(BaseSchema):
    """Update a 2D track."""
    name: Optional[str] = None
    color: Optional[str] = None
    class_id: Optional[str] = None
    start_frame_index: Optional[int] = None
    end_frame_index: Optional[int] = None
    is_interpolated: Optional[bool] = None
    is_complete: Optional[bool] = None
    attributes: Optional[Dict[str, Any]] = None


class Track2DResponse(Track2DBase, TimestampSchema):
    """Response for a 2D track."""
    id: UUID
    task_id: UUID


class BulkTrack2DCreate(BaseSchema):
    """Bulk create 2D tracks."""
    tracks: List[Track2DCreate]


class Migrate4DTo3DRequest(BaseSchema):
    """Request to migrate 4D annotations to 3D annotations."""
    annotation_4d_ids: Optional[List[UUID]] = None
    preserve_uuids: bool = True


class Migrate4DTo3DResponse(BaseSchema):
    """Response for 4D to 3D migration."""
    migrated_count: int
    created_annotation_ids: List[UUID]
    track_id_mapping: Dict[str, str] = Field(default_factory=dict)
    errors: List[Dict[str, Any]] = Field(default_factory=list)


class Migrate3DToFusionRequest(BaseSchema):
    """Request to migrate 3D annotations to Fusion annotations."""
    annotation_3d_ids: Optional[List[UUID]] = None
    preserve_uuids: bool = True


class Migrate3DToFusionResponse(BaseSchema):
    """Response for 3D to Fusion migration."""
    migrated_count: int
    created_annotation_ids: List[UUID]
    errors: List[Dict[str, Any]] = Field(default_factory=list)


class BulkAnnotation3DCreate(BaseSchema):
    """Bulk create 3D annotations."""
    annotations: List[Annotation3DCreate]


class BulkAnnotationFusionCreate(BaseSchema):
    """Bulk create Fusion annotations."""
    annotations: List[AnnotationFusionCreate]


class BulkAnnotation2DCreate(BaseSchema):
    """Bulk create 2D annotations."""
    annotations: List[Annotation2DCreate]



class QAReviewMode(str, Enum):
    VIEW_ONLY = "view_only"
    EDIT = "edit"
    SUGGEST = "suggest"


class QAReviewStatus(str, Enum):
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    PAUSED = "paused"


class ReviewVerdict(str, Enum):
    APPROVED = "approved"
    REJECTED = "rejected"
    FLAGGED = "flagged"
    PENDING = "pending"


class SuggestionSeverity(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class SuggestionType(str, Enum):
    SIZE_ANOMALY = "size_anomaly"
    POSITION_JUMP = "position_jump"
    ORIENTATION_FLIP = "orientation_flip"
    TRACK_DISCONTINUITY = "track_discontinuity"
    LOW_CONFIDENCE = "low_confidence"
    CLASS_MISMATCH = "class_mismatch"
    MISSING_ATTRIBUTES = "missing_attributes"
    AUTO_INTERPOLATED = "auto_interpolated"
    IMPORTED_UNCHECKED = "imported_unchecked"
    OCCLUSION_ISSUE = "occlusion_issue"
    GROUND_PLANE_MISALIGNMENT = "ground_plane_misalignment"
    TRACK_DIMENSION_INCONSISTENCY = "track_dimension_inconsistency"
    VELOCITY_OUTLIER = "velocity_outlier"
    HEADING_MOTION_MISMATCH = "heading_motion_mismatch"
    OVERLAPPING_CUBOIDS = "overlapping_cuboids"
    SHORT_TRACK = "short_track"
    ASPECT_RATIO_ANOMALY = "aspect_ratio_anomaly"
    STATIONARY_WITH_MOTION_CLASS = "stationary_with_motion_class"
    TRACK_GAP = "track_gap"
    TRACK_BOUNDARY_ISSUE = "track_boundary_issue"
    FALSE_NEGATIVE = "false_negative"


class QAReviewCreate(BaseSchema):
    """Start a new QA review session."""
    task_id: UUID
    mode: QAReviewMode = QAReviewMode.VIEW_ONLY
    review_stage: Optional[str] = None


class QAReviewUpdate(BaseSchema):
    """Update a QA review session."""
    status: Optional[QAReviewStatus] = None
    mode: Optional[QAReviewMode] = None


class QAReviewComplete(BaseSchema):
    """Complete a QA review session."""
    final_verdict: str = "completed"
    notes: Optional[str] = None


class QAReviewSummary(BaseSchema):
    """Summary statistics for a QA review."""
    approved: int = 0
    rejected: int = 0
    flagged: int = 0
    pending: int = 0
    total_annotations: int = 0
    suggestions_addressed: int = 0
    suggestions_dismissed: int = 0


class QAReviewResponse(TimestampSchema):
    """Response for a QA review session."""
    id: UUID
    task_id: UUID
    reviewer_id: Optional[UUID] = None
    reviewer_name: Optional[str] = None
    status: str
    mode: str
    review_stage: Optional[str] = None
    started_at: datetime
    completed_at: Optional[datetime] = None
    summary: Optional[QAReviewSummary] = None


class AnnotationReviewCreate(BaseSchema):
    """Review a specific annotation."""
    annotation_id: str
    annotation_table: str = "annotations"
    verdict: ReviewVerdict
    issue_types: Optional[List[str]] = None
    notes: Optional[str] = None
    frame_id: Optional[str] = None
    class_id: Optional[str] = None
    location_x: Optional[float] = None
    location_y: Optional[float] = None
    location_z: Optional[float] = None


class AnnotationReviewUpdate(BaseSchema):
    """Update an annotation review."""
    verdict: Optional[ReviewVerdict] = None
    issue_types: Optional[List[str]] = None
    notes: Optional[str] = None


class AnnotationReviewResponse(TimestampSchema):
    """Response for an annotation review."""
    id: UUID
    qa_review_id: UUID
    annotation_id: str
    annotation_table: str
    verdict: Optional[str] = None
    issue_types: Optional[List[str]] = None
    notes: Optional[str] = None
    reviewed_at: Optional[datetime] = None
    frame_id: Optional[str] = None
    class_id: Optional[str] = None
    location_x: Optional[float] = None
    location_y: Optional[float] = None
    location_z: Optional[float] = None
    annotator_resolved: bool = False


class BulkAnnotationReviewCreate(BaseSchema):
    """Bulk review multiple annotations."""
    reviews: List[AnnotationReviewCreate]


class BulkAnnotationReviewResponse(BaseSchema):
    """Response for bulk annotation review."""
    success_count: int
    error_count: int
    errors: List[Dict[str, Any]] = Field(default_factory=list)


class AnnotationCommentCreate(BaseSchema):
    """Create a comment on an annotation."""
    annotation_id: str
    annotation_table: str = "annotations"
    content: str
    parent_id: Optional[UUID] = None


class AnnotationCommentUpdate(BaseSchema):
    """Update a comment."""
    content: Optional[str] = None


class AnnotationCommentResponse(TimestampSchema):
    """Response for an annotation comment."""
    id: UUID
    annotation_id: str
    annotation_table: str
    user_id: Optional[UUID] = None
    user_name: Optional[str] = None
    parent_id: Optional[UUID] = None
    content: str
    is_resolved: bool
    resolved_by: Optional[UUID] = None
    resolved_at: Optional[datetime] = None
    replies: List["AnnotationCommentResponse"] = Field(default_factory=list)


class ResolveCommentRequest(BaseSchema):
    """Resolve a comment thread."""
    is_resolved: bool = True


class QASuggestionCreate(BaseSchema):
    """Create a QA suggestion (typically auto-generated)."""
    task_id: UUID
    annotation_id: Optional[str] = None
    annotation_table: Optional[str] = None
    frame_id: Optional[str] = None
    suggestion_type: SuggestionType
    severity: SuggestionSeverity = SuggestionSeverity.MEDIUM
    message: str
    details: Optional[Dict[str, Any]] = None


class QASuggestionResponse(BaseSchema):
    """Response for a QA suggestion."""
    id: UUID
    task_id: UUID
    annotation_id: Optional[str] = None
    annotation_table: Optional[str] = None
    frame_id: Optional[str] = None
    suggestion_type: str
    severity: str
    message: str
    details: Optional[Dict[str, Any]] = None
    is_dismissed: bool
    dismissed_by: Optional[UUID] = None
    dismissed_at: Optional[datetime] = None
    created_at: datetime


class DismissSuggestionRequest(BaseSchema):
    """Dismiss a QA suggestion."""
    reason: Optional[str] = None


class GenerateSuggestionsRequest(BaseSchema):
    """Request to generate AI suggestions for a task."""
    task_id: UUID
    regenerate: bool = False
    check_types: Optional[List[SuggestionType]] = None


class GenerateSuggestionsResponse(BaseSchema):
    """Response for suggestion generation."""
    task_id: UUID
    suggestions_count: int
    by_severity: Dict[str, int]
    by_type: Dict[str, int]


class CreateManualSuggestionRequest(BaseSchema):
    """Create a manual QA suggestion (e.g., false negative flag)."""
    task_id: UUID
    frame_id: UUID
    suggestion_type: SuggestionType = SuggestionType.FALSE_NEGATIVE
    severity: Optional[str] = "high"
    message: str
    details: Optional[Dict[str, Any]] = None
    location: Optional[Dict[str, float]] = None
    suggested_class: Optional[str] = None


class QATaskStats(BaseSchema):
    """QA statistics for a task."""
    task_id: UUID
    total_annotations: int
    reviewed_count: int
    pending_count: int
    approved_count: int
    rejected_count: int
    flagged_count: int
    suggestions_count: int
    suggestions_dismissed: int
    comment_count: int
    unresolved_comments: int
    review_progress_percent: float
    has_active_review: bool
    active_review_id: Optional[UUID] = None


AnnotationCommentResponse.model_rebuild()
SceneResponse.model_rebuild()
