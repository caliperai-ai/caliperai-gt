"""
Sensor Fusion Annotation Platform - Main Application

Production-grade annotation platform for autonomous driving data.
"""
import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse

from app.core.config import get_settings
from app.core.database import init_db, close_db, async_session_factory
from app.core.redis_cache import init_redis, close_redis, get_redis
from app.api.v1.router import api_router

settings = get_settings()
logger = logging.getLogger(__name__)


async def initialize_rag():
    """Initialize RAG knowledge base on startup."""
    if not settings.RAG_ENABLED:
        logger.info("RAG is disabled, skipping knowledge base initialization")
        return
    
    try:
        from app.services.knowledge_service import KnowledgeService
        from app.services.embedding_service import get_embedding_service
        from app.core.database import async_session_factory
        
        logger.info("Initializing RAG knowledge base...")
        
        redis = await get_redis()
        
        embedding_service = await get_embedding_service(redis)
        model_ready = await embedding_service.ensure_model_available()
        
        if not model_ready:
            logger.warning(
                f"Embedding model {settings.RAG_EMBEDDING_MODEL} not available. "
                "RAG will work once the model is pulled."
            )
            return
        
        if settings.RAG_REINDEX_ON_STARTUP:
            async with async_session_factory() as db:
                knowledge_service = KnowledgeService(
                    db=db,
                    embedding_service=embedding_service,
                    redis_client=redis,
                )
                await knowledge_service.initialize()
                chunks_indexed = await knowledge_service.load_knowledge_base()
                logger.info(f"RAG knowledge base initialized: {chunks_indexed} chunks indexed")
        else:
            logger.info("RAG startup reindexing disabled, using existing index")
            
    except Exception as e:
        logger.error(f"Failed to initialize RAG: {e}")
        logger.info("Chat will work without RAG context until the issue is resolved")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan manager."""
    await init_db()
    await init_redis()

    await initialize_rag()

    from app.services.alert_service import alert_monitor_loop
    alert_task = asyncio.create_task(alert_monitor_loop())
    logger.info("Performance alert monitor task started")

    yield

    alert_task.cancel()
    try:
        await alert_task
    except asyncio.CancelledError:
        pass
    await close_redis()
    await close_db()


_docs_enabled = settings.ENVIRONMENT == "development"

app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    description="""
    ## Sensor Fusion Annotation Platform
    
    A production-grade annotation platform for autonomous driving sensor data.
    
    ### Features
    - **Campaign Management**: Organize annotation projects at scale
    - **Dataset Taxonomies**: Dynamic class and attribute configuration
    - **Scene Management**: LiDAR + Camera fusion with calibration
    - **Task Workflow**: State machine for annotation lifecycle
    - **Multi-type Annotations**: 3D Cuboids, 2D Boxes, Polylines, Keypoints, Segmentation
    - **AI-Assisted Annotation**: SAM2 segmentation with downloadable models
    """,
    lifespan=lifespan,
    docs_url="/api/docs" if _docs_enabled else None,
    redoc_url="/api/redoc" if _docs_enabled else None,
    openapi_url="/api/openapi.json" if _docs_enabled else None,
    redirect_slashes=False,
)

app.add_middleware(GZipMiddleware, minimum_size=1000)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router, prefix="/api/v1")



@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """Catch-all handler for unexpected server errors.

    Logs the full traceback server-side but returns only a generic message
    to the client so that internal implementation details are never exposed.

    HTTPExceptions are explicitly re-raised so that FastAPI's built-in handler
    returns the correct status code and detail rather than a generic 500.
    """
    if isinstance(exc, HTTPException):
        from fastapi.exception_handlers import http_exception_handler
        return await http_exception_handler(request, exc)

    logger.exception(
        "Unhandled 500 error on %s %s",
        request.method,
        request.url.path,
        exc_info=exc,
    )
    return JSONResponse(
        status_code=500,
        content={"detail": "An internal server error occurred."},
    )

@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "healthy", "version": settings.APP_VERSION}


@app.get("/")
async def root():
    """Root endpoint."""
    response = {
        "name": settings.APP_NAME,
        "version": settings.APP_VERSION,
    }
    if _docs_enabled:
        response["docs"] = "/api/docs"
    return response