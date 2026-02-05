# Port Guardian

> Stop debugging port conflicts. Start shipping.

Port Guardian automatically detects, diagnoses, and resolves port conflicts so you can get back to coding.

## Features

- **Auto-detect ports** from 9 sources (docker-compose, .env, framework configs, Dockerfiles, and more)
- **Smart diagnosis** - identifies if blocker is a native process, Docker container, or orphaned docker-proxy
- **Docker-aware** - shows container names, compose projects, and restart policies
- **Interactive resolution** - kill, skip, or abort with full context
- **`--kill` mode** - kill whatever is on a port in one command
- **`--find` mode** - find an available port instantly
- **JSON output** - machine-readable output for scripting
- **`init` command** - generate `.portguardian.yml` from detected ports

## Installation

```bash
# Run directly with npx
npx port-guardian

# Or install globally
npm install -g port-guardian
```

## Usage

```bash
# Auto-detect ports from project files
port-guardian

# Check specific ports
port-guardian 3000 8080 5432

# Force kill all blockers
port-guardian --force

# CI mode (non-interactive, exit 1 on conflicts)
port-guardian --ci

# Dry run (show what would be done)
port-guardian --dry-run

# Kill whatever is on port 3000
port-guardian --kill 3000

# Kill multiple ports
port-guardian -k 3000 8080

# Kill with JSON output
port-guardian --kill 3000 --json

# Find an available port starting from 3000
port-guardian --find 3000

# Find a random available port
port-guardian --find

# Find with JSON output
port-guardian --find --json

# Generate config from detected ports
port-guardian init

# Overwrite existing config
port-guardian init --force
```

## Configuration

### Option 1: `.portguardian.yml`

```yaml
ports:
  - port: 3000
    name: API Server
  - port: 4200
    name: Frontend
  - port: 5432
    name: PostgreSQL
```

### Option 2: `package.json`

```json
{
  "portGuardian": {
    "ports": [
      { "port": 3000, "name": "API Server" },
      { "port": 4200, "name": "Frontend" }
    ]
  }
}
```

### Auto-detection

Port Guardian automatically detects ports from these sources (in order of confidence):

| Source | Confidence | Description |
|--------|-----------|-------------|
| `.portguardian.yml` | 100% | Explicit port configuration |
| `package.json` | 100% | `portGuardian` field |
| `docker-compose*.yml` | 95% | All compose files (glob) |
| Nx/Angular `project.json` | 90% | Serve target ports |
| Framework configs | 85% | vite, webpack, next, nuxt |
| Server entry point | 80% | `src/main.ts`, `src/server.ts` listen() calls |
| `.env` files | 70-85% | `PORT=`, `*_PORT=`, localhost URLs |
| `package.json` scripts | 70% | `--port` flags in npm scripts |
| `Dockerfile` | 70% | `EXPOSE` and `ENV PORT` directives |

You can exclude detectors in `.portguardian.yml`:

```yaml
ports:
  - port: 3000
    name: App
detect:
  exclude:
    - ".env files"
    - Dockerfile
```

## Example Output

```
  Port Guardian
  Stop debugging port conflicts. Start shipping.

  Detected ports:

  SOURCE                PORT    NAME
  ──────────────────────────────────────────────────
  docker-compose.yml    3306    db
  docker-compose.yml    5432    postgres
  docker-compose.yml    8080    api

  Port Status:

  ✓ Port 3306   (db)        Available
  ✗ Port 5432   (postgres)  BLOCKED
     └─ Process: docker-proxy (PID 12345) [DOCKER]
        └─ Container: old-project-postgres-1
        └─ Project: old-project
        └─ State: running
        └─ Restart: always ⚠
     ⚠ Container has restart:always policy. It will auto-restart when Docker daemon restarts.
  ✓ Port 8080   (api)       Available

  ──────────────────────────────────────────────────
  Summary: 2 available, 1 blocked
```

## Programmatic API

```typescript
import { scan, killPort, findAvailablePort, detectPorts } from 'port-guardian';

// Scan for conflicts
const result = await scan({ ports: [3000, 8080] });

if (result.hasConflicts) {
  for (const port of result.ports) {
    if (!port.available && port.blocker) {
      console.log(`Port ${port.port} blocked by ${port.blocker.processName}`);
    }
  }
}

// Kill whatever is on a port
const killResult = await killPort(3000);
console.log(killResult.killed); // true

// Find an available port
const port = await findAvailablePort(3000);
console.log(port); // 3001 (or next available)

// Detect configured ports
const sources = await detectPorts();
console.log(sources); // [{ port: 3000, name: 'API', source: '...', confidence: 95 }]
```

## Why Port Guardian?

Existing tools solve only part of the problem:

| Tool | Detection | Context | Resolution |
|------|-----------|---------|------------|
| `detect-port` | ✓ | ✗ | ✗ |
| `kill-port` | ✗ | ✗ | ✓ |
| `fkill` | ✗ | ✗ | ✓ |
| **port-guardian** | ✓ | ✓ | ✓ |

Port Guardian gives you the complete picture: what's blocking, why it matters (restart policies!), and how to fix it.

## License

MIT
