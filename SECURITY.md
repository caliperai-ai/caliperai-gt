# Security Policy

## Reporting a vulnerability

We take the security of the Sensor Fusion Annotation Platform seriously. If you
believe you've found a security vulnerability, please report it privately —
**do not open a public GitHub issue**.

Preferred: use GitHub's
[private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)
("Report a vulnerability" under the repository's **Security** tab).

Alternatively, email **info@caliperai.ai** with:

- A description of the vulnerability and its impact.
- Steps to reproduce (proof-of-concept if possible).
- Affected version / commit and configuration (Docker vs. local, any relevant
  environment settings).

Please give us a reasonable window to investigate and release a fix before any
public disclosure. We'll acknowledge your report, keep you updated on progress,
and credit you (if you wish) once the issue is resolved.

## Scope and hardening notes

This project ships with **development-oriented defaults**. Before exposing a
deployment to untrusted networks, review the production guidance in the
[README](README.md#production-deployment) and in particular:

- Set a strong, unique `SECRET_KEY` (≥ 32 chars) and database / object-store
  credentials — never ship the example values.
- Restrict `CORS_ORIGINS` to your real front-end origin(s).
- Terminate TLS at the proxy and set `ENVIRONMENT=production` (disables the
  interactive `/docs` API explorer).
- Keep MinIO/Postgres/Redis on a private network; do not publish their ports
  publicly.

## Supported versions

This is an actively developed open-source project. Security fixes target the
latest `main`. Please make sure you can reproduce an issue against current
`main` before reporting.
