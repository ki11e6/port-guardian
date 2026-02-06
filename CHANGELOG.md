# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.1] - 2026-02-06

### Changed
- Split `cli.ts` (453 lines) into focused modules: `cli-help.ts`, `cli-init.ts`, `cli-interactive.ts`
- Replaced `inquirer` (~95MB install) with `@inquirer/prompts` (modular, much smaller)
- Removed stale `_bmad-output/IMPLEMENTATION-PLAN.md`

### Fixed
- Cache docker availability check to avoid repeated slow calls
- Port validation in scanner, consistent safePid usage in killer
- Timeouts on docker stop/rm/ps commands to prevent CI hangs
- Increased kill signal wait for graceful process shutdown
- `.env` inline comment stripping now respects quoted values
- Port range expansion in docker-compose parsing
- Improved lsof output parsing for NAME field with spaces

### Added
- `CHANGELOG.md`
- Unit tests for `buildActionChoices` and `printHelp` extracted modules

## [0.2.0] - 2026-02-05

### Added
- `init` command to generate `.portguardian.yml` from detected ports
- `--find [port]` flag to find an available port
- `--kill` / `-k` flag to kill processes on specified ports
- `--json` output mode for `--find` and `--kill`
- Port detection from `.env` files (PORT=, *_PORT=, localhost URLs)
- Port detection from Nx/Angular `project.json` serve targets
- Port detection from framework configs (vite, webpack, next, nuxt)
- Port detection from Dockerfiles (EXPOSE, ENV PORT)
- Port detection from server entry points (listen() calls)
- Port detection from npm scripts (--port flags)

### Changed
- Context-aware CLI output (compact for single port, detailed for multi)
- Lazy-load inquirer to speed up CLI startup

### Fixed
- Docker command timeouts to prevent CI hangs
- Code review findings in port detection

## [0.1.1] - 2026-02-05

### Fixed
- Security vulnerabilities and cross-platform support improvements
- Switched to npm OIDC trusted publishing

## [0.1.0] - 2026-02-04

### Added
- Initial release
- Port scanning via `lsof`
- Docker container detection and resolution
- Orphaned docker-proxy detection
- Interactive conflict resolution with inquirer prompts
- Force mode (`--force`) for non-interactive killing
- CI mode (`--ci`) for pipeline integration
- Dry-run mode (`--dry-run`)
- Programmatic API (`scan`, `checkPort`, `checkPorts`, `detectPorts`)
- Port detection from `.portguardian.yml`, `package.json`, `docker-compose*.yml`
