# Port Guardian

> Stop debugging port conflicts. Start shipping.

Port Guardian automatically detects, diagnoses, and resolves port conflicts so you can get back to coding.

## Features

- **Auto-detect ports** from `docker-compose.yml`, `.portguardian.yml`, or `package.json`
- **Smart diagnosis** - identifies if blocker is a native process, Docker container, or orphaned docker-proxy
- **Docker-aware** - shows container names, compose projects, and restart policies
- **Interactive resolution** - kill, skip, or abort with full context
- **Restart policy warnings** - alerts you when `restart:always` may cause issues

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

Port Guardian automatically detects ports from:
- `docker-compose.yml` / `compose.yml`
- `.portguardian.yml`
- `package.json` portGuardian config

## Example Output

```
  🔍 Port Guardian
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
import { scan, killBlocker } from 'port-guardian';

// Scan for conflicts
const result = await scan({ ports: [3000, 8080] });

if (result.hasConflicts) {
  for (const port of result.ports) {
    if (!port.available && port.blocker) {
      console.log(`Port ${port.port} blocked by ${port.blocker.processName}`);

      // Optionally kill the blocker
      await killBlocker(port.blocker);
    }
  }
}
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
