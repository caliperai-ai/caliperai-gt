"""
RBAC (Role-Based Access Control) Service.

Provides authentication dependencies and permission checking utilities
for protecting API endpoints.
"""
import logging
from typing import Annotated, Optional
from uuid import UUID

from fastapi import Depends, HTTPException, status, Request, Query
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from jose import JWTError, jwt

from app.core.config import settings
from app.core.database import get_db
from app.models.models import User, Permission, UserRole, ROLE_PERMISSIONS

logger = logging.getLogger(__name__)


security = HTTPBearer(auto_error=False)


class AuthenticationError(HTTPException):
    """Raised when authentication fails."""
    def __init__(self, detail: str = "Could not validate credentials"):
        super().__init__(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=detail,
            headers={"WWW-Authenticate": "Bearer"},
        )


class PermissionDeniedError(HTTPException):
    """Raised when user lacks required permissions."""
    def __init__(self, detail: str = "Permission denied"):
        super().__init__(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=detail,
        )


async def get_current_user(
    credentials: Annotated[Optional[HTTPAuthorizationCredentials], Depends(security)],
    db: AsyncSession = Depends(get_db),
) -> User:
    """
    Get the current authenticated user from the JWT token.
    
    Raises:
        AuthenticationError: If token is missing, invalid, or user not found.
    """
    if credentials is None:
        raise AuthenticationError("Missing authentication token")
    
    token = credentials.credentials
    
    try:
        payload = jwt.decode(
            token,
            settings.SECRET_KEY,
            algorithms=["HS256"],
        )
        user_id: str = payload.get("sub")
        if user_id is None:
            logger.warning("JWT decode succeeded but 'sub' claim is missing")
            raise AuthenticationError("Authentication failed")
    except JWTError as e:
        logger.warning("JWT validation error in get_current_user: %s", e)
        raise AuthenticationError("Authentication failed")
    
    try:
        user_uuid = UUID(user_id)
    except ValueError:
        logger.warning("Invalid UUID in token 'sub' claim: %r", user_id)
        raise AuthenticationError("Authentication failed")
    
    query = select(User).where(User.id == user_uuid)
    result = await db.execute(query)
    user = result.scalar_one_or_none()
    
    if user is None:
        logger.warning("Authenticated token references non-existent user: %s", user_id)
        raise AuthenticationError("Authentication failed")
    
    if not user.is_active:
        logger.warning("Inactive user attempted access: %s", user_id)
        raise AuthenticationError("Authentication failed")
    
    return user


async def get_user_from_token_or_query(
    credentials: Annotated[Optional[HTTPAuthorizationCredentials], Depends(security)],
    token: Optional[str] = Query(None, description="JWT token for image/data requests"),
    db: AsyncSession = Depends(get_db),
) -> User:
    """
    Get the current authenticated user from either:
    1. Authorization header (Bearer token)
    2. Query parameter 'token'
    
    This is useful for endpoints that serve binary data (images, files) where
    the browser can't send Authorization headers (e.g., <img src="...">).
    
    Raises:
        AuthenticationError: If token is missing, invalid, or user not found.
    """
    token_str = None
    if credentials is not None:
        token_str = credentials.credentials
    elif token is not None:
        token_str = token
    
    if token_str is None:
        raise AuthenticationError("Missing authentication token")
    
    try:
        payload = jwt.decode(
            token_str,
            settings.SECRET_KEY,
            algorithms=["HS256"],
        )
        user_id: str = payload.get("sub")
        if user_id is None:
            logger.warning("JWT decode succeeded but 'sub' claim is missing (token_or_query path)")
            raise AuthenticationError("Authentication failed")
    except JWTError as e:
        logger.warning("JWT validation error in get_user_from_token_or_query: %s", e)
        raise AuthenticationError("Authentication failed")
    
    try:
        user_uuid = UUID(user_id)
    except ValueError:
        logger.warning("Invalid UUID in token 'sub' claim (token_or_query path): %r", user_id)
        raise AuthenticationError("Authentication failed")
    
    query = select(User).where(User.id == user_uuid)
    result = await db.execute(query)
    user = result.scalar_one_or_none()
    
    if user is None:
        logger.warning("Authenticated token references non-existent user (token_or_query path): %s", user_id)
        raise AuthenticationError("Authentication failed")
    
    if not user.is_active:
        logger.warning("Inactive user attempted access (token_or_query path): %s", user_id)
        raise AuthenticationError("Authentication failed")
    
    return user


async def get_current_active_user(
    current_user: Annotated[User, Depends(get_current_user)],
) -> User:
    """Get the current active user."""
    if not current_user.is_active:
        raise AuthenticationError("User account is deactivated")
    return current_user


async def get_optional_current_user(
    credentials: Annotated[Optional[HTTPAuthorizationCredentials], Depends(security)],
    db: AsyncSession = Depends(get_db),
) -> Optional[User]:
    """
    Get the current user if authenticated, otherwise return None.
    Useful for endpoints that work differently for authenticated vs anonymous users.
    """
    if credentials is None:
        return None
    
    try:
        return await get_current_user(credentials, db)
    except AuthenticationError:
        return None


class RequirePermissions:
    """
    Dependency class that checks if the current user has required permissions.
    
    Usage:
        @router.get("/admin-only")
        async def admin_endpoint(
            user: User = Depends(RequirePermissions(Permission.USERS_CREATE))
        ):
            ...
        
        @router.get("/multi-permission")
        async def multi_perm_endpoint(
            user: User = Depends(RequirePermissions(
                Permission.TASKS_READ,
                Permission.ANNOTATIONS_READ,
                require_all=True
            ))
        ):
            ...
    """
    
    def __init__(self, *permissions: Permission, require_all: bool = True):
        """
        Initialize the permission checker.
        
        Args:
            *permissions: One or more permissions to check.
            require_all: If True, user must have ALL permissions.
                        If False, user needs ANY of the permissions.
        """
        self.permissions = permissions
        self.require_all = require_all
    
    async def __call__(
        self,
        current_user: Annotated[User, Depends(get_current_user)],
    ) -> User:
        """Check permissions and return the user if authorized."""
        if not self.permissions:
            return current_user
        
        if self.require_all:
            has_permission = current_user.has_all_permissions(list(self.permissions))
        else:
            has_permission = current_user.has_any_permission(list(self.permissions))
        
        if not has_permission:
            required = ", ".join(p.value for p in self.permissions)
            mode = "all of" if self.require_all else "any of"
            raise PermissionDeniedError(
                f"This action requires {mode}: {required}"
            )
        
        return current_user


class RequirePermissionsWithQuery:
    """
    Same as RequirePermissions but also accepts token via query parameter.
    Useful for data endpoints where browser can't send Authorization headers.
    """
    
    def __init__(self, *permissions: Permission, require_all: bool = True):
        self.permissions = permissions
        self.require_all = require_all
    
    async def __call__(
        self,
        current_user: Annotated[User, Depends(get_user_from_token_or_query)],
    ) -> User:
        """Check permissions and return the user if authorized."""
        if not self.permissions:
            return current_user
        
        if self.require_all:
            has_permission = current_user.has_all_permissions(list(self.permissions))
        else:
            has_permission = current_user.has_any_permission(list(self.permissions))
        
        if not has_permission:
            required = ", ".join(p.value for p in self.permissions)
            mode = "all of" if self.require_all else "any of"
            raise PermissionDeniedError(
                f"This action requires {mode}: {required}"
            )
        
        return current_user


class RequireRole:
    """
    Dependency class that checks if the current user has one of the required roles.
    
    Usage:
        @router.get("/managers-only")
        async def manager_endpoint(
            user: User = Depends(RequireRole(UserRole.ADMIN, UserRole.PROJECT_MANAGER))
        ):
            ...
    """
    
    def __init__(self, *roles: UserRole):
        """
        Initialize the role checker.
        
        Args:
            *roles: One or more roles that are allowed.
        """
        self.roles = roles
    
    async def __call__(
        self,
        current_user: Annotated[User, Depends(get_current_user)],
    ) -> User:
        """Check role and return the user if authorized."""
        if not self.roles:
            return current_user
        
        if current_user.is_superuser:
            return current_user
        
        user_role = UserRole(current_user.role) if current_user.role in [r.value for r in UserRole] else None
        
        if user_role not in self.roles:
            allowed = ", ".join(r.value for r in self.roles)
            raise PermissionDeniedError(
                f"This action requires one of the following roles: {allowed}"
            )
        
        return current_user


RequireAdmin = RequireRole(UserRole.ADMIN)
RequireProjectManager = RequireRole(UserRole.ADMIN, UserRole.PROJECT_MANAGER)
RequireQAReviewer = RequireRole(UserRole.ADMIN, UserRole.PROJECT_MANAGER, UserRole.QA_REVIEWER)
RequireAnnotator = RequireRole(UserRole.ADMIN, UserRole.PROJECT_MANAGER, UserRole.ANNOTATOR)


def check_permission(user: User, permission: Permission) -> bool:
    """
    Utility function to check if a user has a specific permission.
    
    Args:
        user: The user to check.
        permission: The permission to check for.
        
    Returns:
        True if the user has the permission, False otherwise.
    """
    return user.has_permission(permission)


def require_permission(user: User, permission: Permission) -> None:
    """
    Utility function that raises PermissionDeniedError if user lacks permission.
    
    Args:
        user: The user to check.
        permission: The required permission.
        
    Raises:
        PermissionDeniedError: If user lacks the permission.
    """
    if not user.has_permission(permission):
        raise PermissionDeniedError(
            f"This action requires permission: {permission.value}"
        )


def get_role_permissions(role: UserRole | str) -> set[str]:
    """
    Get all permissions for a given role.
    
    Args:
        role: The role to get permissions for.
        
    Returns:
        Set of permission strings for the role.
    """
    role_value = role.value if isinstance(role, UserRole) else role
    return ROLE_PERMISSIONS.get(role_value, set()).copy()


def get_all_roles() -> list[dict]:
    """
    Get all available roles with their descriptions.
    
    Returns:
        List of role dictionaries with name, value, and description.
    """
    return [
        {
            "name": "Admin",
            "value": UserRole.ADMIN.value,
            "description": "Full system access including user management and system configuration",
        },
        {
            "name": "Project Manager",
            "value": UserRole.PROJECT_MANAGER.value,
            "description": "Manages campaigns, datasets, tasks, and can assign work to team members",
        },
        {
            "name": "Annotator",
            "value": UserRole.ANNOTATOR.value,
            "description": "Creates and edits annotations on assigned tasks",
        },
        {
            "name": "QA Reviewer",
            "value": UserRole.QA_REVIEWER.value,
            "description": "Reviews submitted annotations and can accept or reject work",
        },
        {
            "name": "Customer QA",
            "value": UserRole.CUSTOMER_QA.value,
            "description": "External client review for final quality approval",
        },
    ]
