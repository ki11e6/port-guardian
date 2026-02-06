/**
 * CLI Help - Print usage information
 */

export function printHelp(): void {
  console.log(`
  Usage: port-guardian [command] [ports...] [options]

  Commands:
    init            Generate .portguardian.yml from detected ports

  Options:
    -f, --force     Kill all blockers without prompting
    -k, --kill      Kill process on port(s) and exit
    --ci            Non-interactive mode (exit 1 on conflicts)
    --dry-run       Show what would be done without executing
    --find [port]   Find an available port (starting from port, or random)
    --json          Output as JSON (use with --find or --kill)
    -v, --verbose   Verbose output
    -h, --help      Show this help message
    --version       Show version

  Examples:
    port-guardian                  # Auto-detect ports
    port-guardian 3000 8080        # Check specific ports
    port-guardian --force          # Kill all blockers
    port-guardian --ci             # CI mode (fail on conflicts)
    port-guardian --kill 3000      # Kill whatever is on port 3000
    port-guardian -k 3000 8080     # Kill multiple ports
    port-guardian --kill 3000 --json  # Kill with JSON output
    port-guardian --find 3000      # Find available port from 3000
    port-guardian --find           # Find random available port
    port-guardian --find --json    # Output as JSON: {"port": 3001}
    port-guardian init             # Generate config from detected ports
    port-guardian init --force     # Overwrite existing config

  Port Detection Sources (auto-detect order):
    .portguardian.yml       100%  - Explicit port configuration
    package.json            100%  - portGuardian field
    docker-compose*.yml      95%  - All compose files (glob)
    Nx/Angular project.json  90%  - Serve target ports
    Framework configs        85%  - vite, webpack, next, nuxt
    Server entry point       80%  - src/main.ts, src/server.ts listen() calls
    .env files             70-85% - PORT=, *_PORT=, localhost URLs
    package.json scripts     70%  - --port flags in npm scripts
    Dockerfile               70%  - EXPOSE and ENV PORT directives
`);
}
