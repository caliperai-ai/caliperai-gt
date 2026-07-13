"""Create test users for each role to test RBAC functionality."""
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import bcrypt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker

from app.models.models import User, UserRole, Base
from app.core.config import settings


TEST_USERS = [
    {
        "email": "admin@test.com",
        "username": "test_admin",
        "password": "Test123!",
        "full_name": "Test Admin User",
        "role": UserRole.ADMIN,
        "is_superuser": True,
    },
    {
        "email": "pm@test.com",
        "username": "test_pm",
        "password": "Test123!",
        "full_name": "Test Project Manager",
        "role": UserRole.PROJECT_MANAGER,
        "is_superuser": False,
    },
    {
        "email": "annotator@test.com",
        "username": "test_annotator",
        "password": "Test123!",
        "full_name": "Test Annotator",
        "role": UserRole.ANNOTATOR,
        "is_superuser": False,
    },
    {
        "email": "qa@test.com",
        "username": "test_qa",
        "password": "Test123!",
        "full_name": "Test QA Reviewer",
        "role": UserRole.QA_REVIEWER,
        "is_superuser": False,
    },
    {
        "email": "customer@test.com",
        "username": "test_customer",
        "password": "Test123!",
        "full_name": "Test Customer QA",
        "role": UserRole.CUSTOMER_QA,
        "is_superuser": False,
    },
]


async def create_test_users():
    """Create all test users."""
    
    engine = create_async_engine(settings.DATABASE_URL, echo=False)
    
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    
    async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    
    created_count = 0
    skipped_count = 0
    
    async with async_session() as session:
        for user_config in TEST_USERS:
            query = select(User).where(
                (User.email == user_config["email"]) | (User.username == user_config["username"])
            )
            result = await session.execute(query)
            existing_user = result.scalar_one_or_none()
            
            if existing_user:
                print(f"⏭️  Skipping '{user_config['username']}' - already exists")
                skipped_count += 1
                continue
            
            hashed_password = bcrypt.hashpw(
                user_config["password"].encode(), 
                bcrypt.gensalt()
            ).decode()
            
            user = User(
                email=user_config["email"],
                username=user_config["username"],
                hashed_password=hashed_password,
                full_name=user_config["full_name"],
                role=user_config["role"].value,
                is_active=True,
                is_superuser=user_config["is_superuser"],
            )
            
            session.add(user)
            await session.commit()
            await session.refresh(user)
            
            print(f"✅ Created: {user.username} ({user.role})")
            created_count += 1
    
    await engine.dispose()
    
    print("\n" + "=" * 60)
    print("TEST USER CREATION SUMMARY")
    print("=" * 60)
    print(f"Created: {created_count}")
    print(f"Skipped: {skipped_count}")
    print("\n" + "-" * 60)
    print("TEST USER CREDENTIALS")
    print("-" * 60)
    print(f"{'Username':<20} {'Role':<20} {'Password'}")
    print("-" * 60)
    for user_config in TEST_USERS:
        print(f"{user_config['username']:<20} {user_config['role'].value:<20} {user_config['password']}")
    print("=" * 60)
    print("\nRole Permissions Summary:")
    print("-" * 60)
    print("ADMIN:           Full access to all features")
    print("PROJECT_MANAGER: Manage campaigns, datasets, tasks, assign work")
    print("ANNOTATOR:       Only sees assigned tasks, create/edit annotations")
    print("QA_REVIEWER:     Review submitted tasks, approve/reject annotations")
    print("CUSTOMER_QA:     Final review, customer acceptance")
    print("=" * 60)


async def delete_test_users():
    """Delete all test users (for cleanup)."""
    
    engine = create_async_engine(settings.DATABASE_URL, echo=False)
    async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    
    async with async_session() as session:
        for user_config in TEST_USERS:
            query = select(User).where(User.username == user_config["username"])
            result = await session.execute(query)
            user = result.scalar_one_or_none()
            
            if user:
                await session.delete(user)
                print(f"🗑️  Deleted: {user.username}")
            else:
                print(f"⏭️  Not found: {user_config['username']}")
        
        await session.commit()
    
    await engine.dispose()
    print("\n✅ Test user cleanup complete!")


if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description="Manage test users for RBAC testing")
    parser.add_argument(
        "--delete", 
        action="store_true", 
        help="Delete test users instead of creating them"
    )
    
    args = parser.parse_args()
    
    if args.delete:
        asyncio.run(delete_test_users())
    else:
        asyncio.run(create_test_users())
