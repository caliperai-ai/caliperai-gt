# Contributing

Thanks for your interest in improving the Sensor Fusion Annotation Platform!
Contributions of all kinds are welcome — bug reports, documentation, tests, and
code.

## Ways to contribute

- **Report a bug** — open an issue with steps to reproduce, what you expected,
  and what happened. Include your OS, browser, and whether you're running the
  Docker stack or a local dev setup.
- **Request a feature** — open an issue describing the use case first, before
  writing code, so we can discuss the approach.
- **Improve docs** — corrections and clarifications to the README or the docs in
  [`docs/`](docs/) are very welcome.
- **Submit code** — see the workflow below.

## Development setup

The fastest way to a working stack is the Docker quick start in the
[README](README.md#quick-start-docker). For iterating on the code, use the
[Local Development](README.md#local-development-without-docker) flow (Vite dev
server for the frontend, `uvicorn --reload` for the backend) with Postgres,
Redis, and MinIO provided by Docker.

- **Backend:** FastAPI + SQLAlchemy (async), Python 3.11.
- **Frontend:** React 18 + TypeScript + Vite, Three.js, Zustand.

## Pull request workflow

1. Fork the repo and create a topic branch off `main`
   (`git checkout -b fix/short-description`).
2. Make your change. Keep it focused — one logical change per PR.
3. Make sure it builds and passes checks:
   - Frontend: `cd frontend && npm run build` (runs `tsc` + Vite build) and
     `npm run lint`.
   - Backend: run the test suite in `backend/tests/` (`pytest`).
4. Match the surrounding code style. We favor small, readable diffs and comments
   that explain *why*, not *what*.
5. Open a PR against `main` with a clear description of the change and the
   motivation. Link any related issue.

## Commit messages

Use clear, present-tense messages. Conventional-commit prefixes
(`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`) are appreciated but not
required.

## Reporting security issues

Please **do not** open a public issue for security vulnerabilities. See
[SECURITY.md](SECURITY.md) for private disclosure instructions.

## Code of conduct

By participating you agree to abide by our
[Code of Conduct](CODE_OF_CONDUCT.md).

## License

By contributing, you agree that your contributions will be licensed under the
[Apache License 2.0](LICENSE) that covers this project.
