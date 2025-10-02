#!/bin/bash

# Example script showing unified Mockprox config usage

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${BLUE}=== Mockprox Unified Config Demo ===${NC}\n"

# Example 1: Generate config from OpenAPI
echo -e "${GREEN}1. Generate config from OpenAPI spec${NC}"
echo "Command:"
echo "  mockprox-cli generate-config --input my-api.json --output mockprox.config.json"
echo ""
echo "Result:"
echo "  - Auto-discovers all endpoints and properties"
echo "  - Creates base config with sensible defaults"
echo "  - Includes commented examples for customization"
echo ""
echo -e "${YELLOW}---${NC}\n"

# Example 2: Customize and use config
echo -e "${GREEN}2. Customize generated config and start server${NC}"
echo "Edit mockprox.config.json:"
echo "  - Set array defaultCount to 10"
echo "  - Add static email: 'john.doe@gmail.com'"
echo "  - Configure success/fail states"
echo ""
echo "Start server:"
echo "  mockprox-cli start --data my-api.json --config mockprox.config.json"
echo ""
echo -e "${YELLOW}---${NC}\n"

# Example 3: Test different states
echo -e "${GREEN}3. Testing different response states${NC}"
echo ""
echo "# Default success state"
echo "curl http://localhost:3000/api/users"
echo "# => 200 OK with 10 users"
echo ""
echo "# Switch to fail state"
echo "curl 'http://localhost:3000/api/users?mock-state=fail'"
echo "# => 500 Internal Server Error"
echo ""
echo "# Test wildcard matching"
echo "curl 'http://localhost:3000/api/orders/123'"
echo "curl 'http://localhost:3000/api/orders/123?mock-state=fail'"
echo ""
echo "# Test rate limiting state"
echo "curl 'http://localhost:3000/api/orders?mock-state=ratelimit'"
echo "# => 429 Too Many Requests"
echo ""
echo -e "${YELLOW}---${NC}\n"

# Example 4: Combine with external faker-factory
echo -e "${GREEN}4. Combine unified config with external faker-factory (backward compatible)${NC}"
echo "Command:"
echo "  mockprox-cli start --data my-api.json \\"
echo "    --config mockprox.config.json \\"
echo "    --faker-factory ./custom-factories.js"
echo ""
echo "Merge Priority:"
echo "  1. config.dataGeneration.propertyOverrides (HIGHEST)"
echo "  2. config.fakerFactories (inline)"
echo "  3. --faker-factory file (external)"
echo "  4. Built-in defaults (LOWEST)"
echo ""
echo -e "${YELLOW}---${NC}\n"

# Example 5: With proxy-first mode
echo -e "${GREEN}5. Using with proxy-first mode${NC}"
echo "Command:"
echo "  mockprox-cli start --data my-api.json \\"
echo "    --proxy-url http://api.example.com \\"
echo "    --proxy-first \\"
echo "    --config mockprox.config.json"
echo ""
echo "Behavior:"
echo "  - Proxy-first routes will ignore responseStates"
echo "  - Only mocked routes will use state-based responses"
echo "  - dataGeneration still applies during OpenAPI import"
echo ""
echo -e "${YELLOW}---${NC}\n"

# Example 6: Complete workflow
echo -e "${GREEN}6. Complete workflow from scratch${NC}"
echo ""
echo "Step 1: Generate config from OpenAPI"
echo "  mockprox-cli generate-config \\"
echo "    --input ./my-openapi.yml \\"
echo "    --output ./mockprox.config.json"
echo ""
echo "Step 2: Review and customize mockprox.config.json"
echo "  - Adjust array counts, property overrides"
echo "  - Customize success/fail responses"
echo "  - Add custom faker factories"
echo ""
echo "Step 3: Start server with config"
echo "  mockprox-cli start \\"
echo "    --data ./my-openapi.yml \\"
echo "    --config ./mockprox.config.json"
echo ""
echo "Step 4: Test endpoints with different states"
echo "  curl http://localhost:3000/api/users"
echo "  curl 'http://localhost:3000/api/users?mock-state=fail'"
echo "  curl 'http://localhost:3000/api/users?mock-state=unauthorized'"
echo ""
echo -e "${YELLOW}---${NC}\n"

echo -e "${BLUE}=== End of Demo ===${NC}"
echo ""
echo "For more information, see:"
echo "  - packages/cli/README.md"
echo "  - agents/mockprox-knowledge.md"
echo "  - examples/mockprox.config.json"
