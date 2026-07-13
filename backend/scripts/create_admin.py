"""Create an initial admin user for the annotation platform."""
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
from app.core.encryption import get_encryption_service


async def create_admin_user(
    email: str = "admin@example.com",
    username: str = "admin",
    password: str = "admin123",
    full_name: str = "System Administrator",
    reset_password: bool = False,
):
    """Create an admin user, or reset an existing one's password.

    By default this refuses to touch an existing user. Pass ``reset_password=True``
    (CLI: ``--reset-password``) to update the password of the matching user and
    (re)ensure it is an active admin superuser — useful when you're locked out of
    an existing deployment.
    """

    engine = create_async_engine(settings.DATABASE_URL, echo=True)

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async with async_session() as session:
        query = select(User).where(
            (User.email == email) | (User.username == username)
        )
        result = await session.execute(query)
        existing_user = result.scalar_one_or_none()

        if existing_user:
            if not reset_password:
                print(f"❌ User with email '{email}' or username '{username}' already exists!")
                print(f"   Existing user: {existing_user.username} ({existing_user.email})")
                print("   Re-run with --reset-password to update this user's password.")
                return
            # Reset the existing user's password and (re)promote to active admin.
            existing_user.hashed_password = bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()
            existing_user.is_active = True
            existing_user.is_superuser = True
            existing_user.role = UserRole.ADMIN.value
            existing_user.must_change_password = False
            await session.commit()
            print("✅ Password reset successfully!")
            print(f"   Username: {existing_user.username}")
            print(f"   Email: {existing_user.email}")
            print(f"   Password: {password}")
            print(f"   Role: {existing_user.role}   Superuser: {existing_user.is_superuser}")
            await engine.dispose()
            return

        hashed_password = bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()
        
        admin = User(
            email=email,
            email_blind_index=get_encryption_service().blind_index(email),
            username=username,
            hashed_password=hashed_password,
            full_name=full_name,
            role=UserRole.ADMIN.value,
            is_active=True,
            is_superuser=True,
            must_change_password=False,
        )
        
        session.add(admin)
        await session.commit()
        await session.refresh(admin)
        
        print("✅ Admin user created successfully!")
        print(f"   Email: {email}")
        print(f"   Username: {username}")
        print(f"   Password: {password}")
        print(f"   Role: {admin.role}")
        print(f"   Superuser: {admin.is_superuser}")
    
    await engine.dispose()


if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description="Create an admin user")
    parser.add_argument("--email", default="admin@example.com", help="Admin email")
    parser.add_argument("--username", default="admin", help="Admin username")
    parser.add_argument("--password", default="admin123", help="Admin password")
    parser.add_argument("--name", default="System Administrator", help="Full name")
    parser.add_argument("--reset-password", action="store_true",
                        help="If the user already exists, reset its password and re-promote to admin")

    args = parser.parse_args()

    asyncio.run(create_admin_user(
        email=args.email,
        username=args.username,
        password=args.password,
        full_name=args.name,
        reset_password=args.reset_password,
    ))
