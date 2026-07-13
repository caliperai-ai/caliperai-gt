# Sensor Fusion Annotation Platform

An open-source, production-grade annotation platform for autonomous-driving sensor
data. Label **LiDAR point clouds** and **camera images** together with real-time
3D-to-2D projection, multi-object tracking, and a full human review workflow.

📺 **[Feature walkthroughs & how-to videos](https://www.youtube.com/@CaliperAI-f7u)**

- **Backend:** FastAPI (Python 3.11), PostgreSQL + pgvector, Redis, MinIO
- **Frontend:** React 18 + TypeScript, Three.js, Zustand
- **AI-assist:** SAM2 segmentation (bring your own downloadable model)
- **Optional:** Ollama-powered in-app assistant/chatbot

---

## Table of Contents

1. [Features](#features)
2. [Architecture](#architecture)
3. [Prerequisites](#prerequisites)
4. [Quick Start (Docker)](#quick-start-docker)
5. [Configuration](#configuration)
6. [Verify It Works](#verify-it-works)
7. [Importing Your Data](#importing-your-data)
8. [AI-Assisted Segmentation (SAM2)](#ai-assisted-segmentation-sam2)
9. [Production Deployment](#production-deployment)
10. [Local Development (without Docker)](#local-development-without-docker)
11. [Feature Toggles & Branding](#feature-toggles--branding)
12. [Keyboard Shortcuts](#keyboard-shortcuts)
13. [Project Structure](#project-structure)
14. [Enterprise](#enterprise)
15. [Contributing](#contributing)
16. [License](#license)

---

## Features

**Annotation**
- **3D cuboids** — full-rotation bounding boxes (yaw / pitch / roll) on LiDAR
- **2D boxes, polylines, polygons, keypoints** on camera images
- **3D semantic segmentation** — per-point LiDAR labeling
- **AI-assisted segmentation (SAM2)** — click-to-segment in 2D images and a
  Segment-to-3D workflow; runs against a downloadable SAM2 model
- **Manual lane / polyline editing** — Bézier + smoothing helpers

**Sensor fusion**
- Real-time 3D→2D projection via calibration matrices
- Multi-camera synchronized views; orthographic BEV / Side / Front editing

**Multi-object tracking**
- Track management across frames with keyframe interpolation
- Track merging and 4D temporal stacking

**Workflow & review**
- Campaigns → Datasets → Scenes → Tasks lifecycle
- Human **QA review** workflow (Annotation → QA → Customer QA → Accepted) with
  manual issue flagging and false-negative marking
- **RBAC** (admin, project_manager, annotator, qa_reviewer, customer_qa) and
  optional **SSO/OIDC** (Google, Azure AD, Okta, Keycloak)

**Data**
- Import/export (KITTI-style and platform-native formats)
- Optional Google Cloud Storage sync
- Taxonomies with class + attribute configuration
- PM analytics dashboard
- Optional in-app AI assistant (RAG over a bundled knowledge base, via Ollama)

---

## Architecture

```
                         ┌──────────────┐
   Browser ── :3000 ───► │   frontend   │  React + nginx (serves SPA, proxies /api)
                         └──────┬───────┘
                                │ /api/v1
                         ┌──────▼───────┐
                         │   backend    │  FastAPI (:8000)
                         └──┬───┬───┬───┘
              ┌─────────────┘   │   └─────────────┐
        ┌─────▼─────┐    ┌──────▼─────┐    ┌──────▼──────┐
        │ postgres  │    │   redis    │    │    minio    │
        │ +pgvector │    │  (cache)   │    │  (objects)  │
        └───────────┘    └────────────┘    └─────────────┘

   Optional:  sam2 (AI segmentation)   ·   ollama (in-app assistant)
```

---

## Prerequisites

- **Docker** 24+ and **Docker Compose** v2
- ~4 GB free RAM for the core stack
- (Optional) an NVIDIA GPU + `nvidia-container-toolkit` for SAM2 GPU inference
- (Optional) Node 20+ and Python 3.11 for running services outside Docker

---

## Quick Start (Docker)

```bash
# 1. Clone
git clone https://github.com/caliperai-ai/caliperai-gt.git && cd caliperai-gt

# 2. Configure — copy the template and set at least SECRET_KEY (>= 32 chars)
cp .env.example .env
#   edit .env:  SECRET_KEY, POSTGRES_PASSWORD, MinIO credentials

# 3. Start the core stack (postgres, redis, minio, backend, frontend)
docker compose up -d postgres redis minio backend frontend

# 4. Create an admin user (tables auto-create on first backend start)
docker compose exec backend python scripts/create_admin.py \
  --email admin@example.com --username admin --password 'change-me-123'

# 5. Open the app
#    Frontend  -> http://localhost:3000
#    API docs  -> http://localhost:8000/docs   (dev only)
```

Log in with the credentials from step 4.

> **Locked out / forgot the password?** The admin script refuses to overwrite an
> existing user, so re-running it prints "already exists". To reset an existing
> user's password (and re-promote it to an active admin), add `--reset-password`:
>
> ```bash
> docker compose exec backend python scripts/create_admin.py \
>   --username admin --password 'new-password-123' --reset-password
> ```

> The `ollama` and any GPU services are optional and omitted above — the core
> stack runs without them. Add `ollama` to the `up` list to enable the in-app assistant.

---

## Configuration

Copy `.env.example` → `.env`. In Docker, service hostnames (postgres, redis, minio)
are wired automatically; you mainly set secrets and ports.

| Variable | Purpose | Notes |
|---|---|---|
| `SECRET_KEY` | JWT signing secret | **Required, ≥ 32 chars** |
| `POSTGRES_PASSWORD` | Postgres password | Set before first start |
| `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD` | MinIO root credentials | Set `OBJECT_STORAGE_ACCESS_KEY`/`OBJECT_STORAGE_SECRET_KEY` to the same values (see `.env.example`) |
| `MINIO_KMS_AUTO_ENCRYPTION` | MinIO at-rest encryption | Set `off` for local (default `on` needs a KMS key) |
| `CORS_ORIGINS` | Allowed browser origins | e.g. `http://localhost:3000` |
| `*_PORT` | Host port mappings | Defaults: FE 3000, API 8000, PG 5432, Redis 6379, MinIO 9000/9001 |
| `BUILD_TARGET` | `development` or `production` | Dev = hot reload |
| `LLM_PROVIDER` / `OLLAMA_*` | In-app assistant | Optional |
| `SSO_*` | OIDC providers | Optional; leave blank to disable |

Feature-gating (`FEATURE_*`) and branding (`BRAND_*`) are described under
[Feature Toggles & Branding](#feature-toggles--branding).

---

## Verify It Works

```bash
# All core containers healthy?
docker compose ps

# Backend health
curl -s http://localhost:8000/health

# Log in via the API (should return an access_token)
curl -s -X POST http://localhost:8000/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"change-me-123"}'
```

Then open http://localhost:3000, sign in, create a Campaign → Dataset, upload a
scene, and open a task to annotate.

---

## Importing Your Data

Annotation work starts from an imported **scene** — a `.zip` bundling LiDAR
point clouds, camera images, and sensor calibration. The minimum viable bundle
is just a `lidar/` folder of point clouds:

```
my_scene/
├── lidar/            frame_000000.pcd, frame_000001.pcd, …   (.pcd or .bin)
├── cameras/          front/frame_000000.jpg, left/…          (optional)
├── calibration.json  LiDAR↔camera extrinsics + intrinsics    (optional)
└── ego_poses/poses.json   per-frame ego trajectory           (optional)
```

Create a Campaign → Dataset in the UI, then **Import** the zip into the dataset.

👉 **Docs:**
- [`docs/DATA_FORMAT.md`](docs/DATA_FORMAT.md) — the scene bundle: point-cloud/image
  formats, `calibration.json` and ego-pose shapes, coordinate conventions, and the
  `/api/v1/import/upload-zip` endpoint.
- [`docs/ANNOTATION_FORMATS.md`](docs/ANNOTATION_FORMATS.md) — annotation
  **import/export** formats and JSON schemas (platform-native, KITTI, COCO,
  SemanticKITTI) and the export endpoints.
- [`docs/ANNOTATION_GUIDE.md`](docs/ANNOTATION_GUIDE.md) — how to **use** the
  annotation tools (3D cuboids, segmentation, 2D, tracking, QA).

> **Tip:** frames are matched by sorted filename position, so zero-pad names
> identically across `lidar/` and every `cameras/<cam>/` folder
> (`frame_000000`, `frame_000001`, …).

**Just have a video?** You can also upload a **video file** (MP4/AVI/MOV/MKV/WebM)
and the platform extracts its frames into a camera-only scene for 2D annotation —
no bundle needed (requires `ffmpeg` on the backend). See the *Video input* section
of [`docs/DATA_FORMAT.md`](docs/DATA_FORMAT.md#video-input-extract-frames-from-a-video).

---

## AI-Assisted Segmentation (SAM2)

SAM2 powers the interactive **AI Segment** (2D) and **Segment-to-3D** tools. It is
an open model you download and run yourself.

```bash
# Download SAM2 model weights (into the backend's model cache)
docker compose exec backend python scripts/download_sam2_models.py

# CPU-only SAM2 service
docker compose -f docker-compose.yml -f docker-compose.sam2.yml up -d

# GPU (requires nvidia-container-toolkit)
docker compose -f docker-compose.yml -f docker-compose.gpu.yml up -d
```

Set `SAM2_MODE=mock` (default) to run the UI without a real model, or `SAM2_MODE=api`
with `SAM2_API_URL` pointing at the SAM2 service.

---

## Production Deployment

The stack is domain-agnostic — **you supply your own hostname and TLS**; nothing
is hardcoded. Configure everything through `.env`.

```bash
# 1. Create your production env and set YOUR values
cp .env.production.example .env
#    In .env, set at minimum:
#      SECRET_KEY, POSTGRES_PASSWORD, MinIO creds     — strong, unique secrets
#      DOMAIN=annotate.example.com                    — your public hostname
#      CORS_ORIGINS=https://annotate.example.com      — your public URL(s)

# 2. Generate the internal service TLS certs and load them into the
#    external volume the stack mounts (first run only):
./scripts/gen_internal_certs.sh
docker volume create caliperai-gt_internal_certs
docker run --rm -v caliperai-gt_internal_certs:/dest -v "$(pwd)/certs":/src \
  busybox sh -c "cp -r /src/. /dest/"

# 3. Start the stack
docker compose -f docker-compose.prod.yml up -d
#    + GPU/SAM2:
docker compose -f docker-compose.prod.yml -f docker-compose.prod.gpu.yml up -d

# 4. The backend auto-creates the schema on first start. On a FRESH database,
#    stamp that state so future migrations apply cleanly:
docker compose -f docker-compose.prod.yml exec backend alembic stamp head
#    (Upgrading an EXISTING deployment instead? Run: alembic upgrade head)

# 5. Create the first admin
docker compose -f docker-compose.prod.yml exec backend python scripts/create_admin.py
```

**Using your own domain.** The frontend calls the API at a relative `/api` path,
so it works on any hostname; the backend's allowed origins come from
`CORS_ORIGINS`; and the bundled nginx accepts any host (`server_name _`). To go
live: point your DNS at the host, terminate TLS at your edge/reverse proxy (or
mount certs via `SSL_CERT_PATH`/`SSL_KEY_PATH`), and set `CORS_ORIGINS` to your
public URL. The bundled frontend nginx proxies `/api` to the backend — see
`frontend/nginx.proxy.conf`.

---

## Local Development (without Docker)

> **Optional.** Running the platform needs **Docker only** (see
> [Quick Start](#quick-start-docker)) — you never have to install Node or Python
> locally. This section is just for contributors who want to iterate on the
> frontend/backend outside containers (e.g. Vite hot-reload). The Docker image
> builds the frontend with `npm` internally.

**Backend**
```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -e .            # or: pip install -r requirements
uvicorn app.main:app --reload --port 8000
```

**Frontend**
```bash
cd frontend
npm install
npm run dev                 # Vite dev server on :5173
npm run build               # type-check + production bundle
```

You still need Postgres, Redis, and MinIO running (the quick-start compose can
provide just those: `docker compose up -d postgres redis minio`).

---

## Feature Toggles & Branding

Optional UI features can be hidden per deployment without a rebuild:

- Flags live in a committed file, e.g. `deploy/features/caliper.env`
  (`FEATURE_PM_DASHBOARD=`, `FEATURE_CHAT=`; blank = on, `off` = hidden).
- The frontend loads them via `env_file:` → `docker-entrypoint.d/20-features.sh`
  regenerates `window.__FEATURES__` on container start.
- Register a new flag in `frontend/src/config/features.ts`, wrap its UI in
  `<FeatureGate feature="...">`, then add a `FEATURE_*` line.

Branding works the same way via `BRAND_*` env → `10-brand.sh` → `window.__BRAND__`
(`frontend/src/config/branding.ts`), so a single image can be re-skinned at runtime.

---

## Keyboard Shortcuts

| Key | Action | | Key | Action |
|---|---|---|---|---|
| `V` | Select | | `Q`/`E` | Rotate yaw ±5° (cuboid) |
| `C` | Cuboid | | `Shift+Q/E` | Rotate yaw ±1° |
| `B` | 2D box | | `R` | Reset rotation |
| `L` | Polyline | | `W`/`S` `A`/`D` `Z`/`X` | Resize cuboid (±0.1 m) |
| `P` | Polygon (manual) | | `←`/`→` | Move / navigate frames |
| `W` | AI Segment (SAM2) | | `Delete` | Delete selected |
| `T` | Track | | `Ctrl+S` | Save |

QA review: `1` approve · `2` reject · `3` flag · `F` flag missing object.

---

## Project Structure

```
caliperai-gt/
├── backend/
│   ├── app/
│   │   ├── api/v1/endpoints/   # REST API
│   │   ├── models/ schemas/    # SQLAlchemy models · Pydantic schemas
│   │   └── services/           # Business logic (QA workflow, SAM2, GCS, ...)
│   ├── alembic/                # DB migrations
│   ├── knowledge_base/         # RAG content for the in-app assistant
│   └── scripts/                # create_admin.py, download_sam2_models.py, ...
├── frontend/
│   └── src/
│       ├── components/canvas/  # LidarCanvas, OrthographicViews, 2D view
│       ├── pages/              # FusionEditorV2, dashboards, taxonomy, ...
│       ├── config/             # branding.ts, features.ts
│       └── store/              # Zustand stores
├── deploy/features/            # committed feature-toggle profiles
├── docker-compose.yml          # dev stack
├── docker-compose.prod.yml     # production stack
└── docker-compose.sam2.yml / .gpu.yml  # optional SAM2 / GPU overrides
```

---

## Enterprise

The open-source platform is fully functional and self-hostable. **Caliper AI**
also offers a commercial edition with additional capabilities:

- **3D LiDAR auto-annotation** — AI-driven automatic labeling of point clouds
  (3D cuboids and 3D segmentation) with model-in-the-loop pre-labeling
- **Advanced AI-assisted labeling** — auto/pre-labeling workflows beyond the
  bundled SAM2 assist
- **Team operations & analytics** — live team-efficiency monitoring, productivity
  dashboards, and workforce management
- **Self-hosted LLM chat** — a private, in-app AI assistant running entirely on
  your own infrastructure
- **Managed hosting & scaling** — deployment, upgrades, and operations handled for you
- **Security & compliance** — audit logging, advanced access controls, and
  compliance support (the open-source edition already includes SSO/OIDC + RBAC)
- **Priority support & SLAs**, onboarding, and custom integrations

📧 For details or a demo, contact **[info@caliperai.ai](mailto:info@caliperai.ai)**.

---

## Contributing

Contributions are welcome — bug reports, docs, tests, and code. See
[CONTRIBUTING.md](CONTRIBUTING.md) for the development setup and pull-request
workflow, and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) for community guidelines.

Found a security issue? Please report it privately — see
[SECURITY.md](SECURITY.md). Do not open a public issue for vulnerabilities.

---

## License

Licensed under the [Apache License 2.0](LICENSE) © Caliper AI. See
[NOTICE](NOTICE) for attribution.
