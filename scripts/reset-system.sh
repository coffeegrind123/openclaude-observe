#!/bin/bash

echo "Resetting Multi-Agent Observability System"
echo "============================================"

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Get the directory of this script
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
# Get the project root directory (parent of scripts)
PROJECT_ROOT="$( cd "$SCRIPT_DIR/.." && pwd )"

# Stop all containers
echo -e "\n${YELLOW}Stopping containers...${NC}"
cd "$PROJECT_ROOT"
if docker compose down >/dev/null 2>&1; then
    echo -e "${GREEN}Containers stopped${NC}"
else
    echo -e "${GREEN}No containers running${NC}"
fi

# Clean up SQLite WAL files in data dir
echo -e "\n${YELLOW}Cleaning up SQLite WAL files...${NC}"
if [ -f "$PROJECT_ROOT/data/events.db-wal" ]; then
    rm -f "$PROJECT_ROOT/data/events.db-wal" "$PROJECT_ROOT/data/events.db-shm"
    echo -e "${GREEN}Removed SQLite WAL files${NC}"
else
    echo -e "${GREEN}No WAL files to clean${NC}"
fi

echo -e "\n${GREEN}System reset complete!${NC}"
echo -e "\nTo start fresh: ${YELLOW}./scripts/start-system.sh${NC}"
