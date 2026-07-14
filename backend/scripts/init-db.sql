-- Database initialization script
-- This runs when PostgreSQL container starts for the first time

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "postgis";
CREATE EXTENSION IF NOT EXISTS "btree_gist";
-- pgcrypto: provides gen_random_uuid() used as a column server-default by an
-- older migration (built-in on PostgreSQL 13+, but kept for compatibility).
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Create application database (if not exists)
-- Note: The database is created by Docker Compose environment variable

-- Grant privileges
GRANT ALL PRIVILEGES ON DATABASE annotation_platform TO postgres;

-- Set timezone
SET timezone = 'UTC';

-- Performance tuning for annotation workload
ALTER SYSTEM SET shared_buffers = '256MB';
ALTER SYSTEM SET effective_cache_size = '1GB';
ALTER SYSTEM SET maintenance_work_mem = '128MB';
ALTER SYSTEM SET checkpoint_completion_target = 0.9;
ALTER SYSTEM SET wal_buffers = '16MB';
ALTER SYSTEM SET default_statistics_target = 100;
ALTER SYSTEM SET random_page_cost = 1.1;
ALTER SYSTEM SET effective_io_concurrency = 200;
ALTER SYSTEM SET work_mem = '4MB';
ALTER SYSTEM SET min_wal_size = '512MB';
ALTER SYSTEM SET max_wal_size = '2GB';
