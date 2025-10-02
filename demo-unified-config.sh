#!/bin/bash
#
# Mockprox Unified Config System Demo
# 
# This script demonstrates the complete workflow:
# 1. Generate config from OpenAPI spec
# 2. Customize the config (simulated)
# 3. Start server with config
# 4. Test endpoints with state switching
#

set -e  # Exit on error

echo "=========================================="
echo "Mockprox Unified Config Demo"
echo "=========================================="
echo ""

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
CLI_PATH="./packages/cli"
OPENAPI_SPEC="$CLI_PATH/test/pokeapi.openapi.yml"
CONFIG_FILE="$CLI_PATH/test/demo-config.json"
DATA_FILE="$CLI_PATH/test/demo-data.json"
PORT=3456

# Clean up from previous runs
echo -e "${BLUE}Cleaning up from previous runs...${NC}"
rm -f "$CONFIG_FILE" "$DATA_FILE"
echo ""

# Step 1: Generate config from OpenAPI
echo -e "${GREEN}Step 1: Generate config from OpenAPI spec${NC}"
echo "Command: mockprox-cli generate-config --input $OPENAPI_SPEC --output $CONFIG_FILE --force"
cd "$CLI_PATH"
node ./bin/dev.js generate-config --input ./test/pokeapi.openapi.yml --output ./test/demo-config.json --force
cd ../..
echo ""

# Step 2: Show generated config structure
echo -e "${GREEN}Step 2: Review generated config${NC}"
echo "Config has been generated with:"
echo "  - Array default count: 10"
echo "  - Property overrides for discovered properties"
echo "  - Response states for all endpoints"
echo ""
echo "First 50 lines of generated config:"
head -50 "$CONFIG_FILE"
echo "..."
echo ""

# Step 3: Customize config (simulate user editing)
echo -e "${GREEN}Step 3: Customize config${NC}"
echo "In real usage, you would edit the config file to:"
echo "  - Adjust array counts"
echo "  - Add specific property values"
echo "  - Define response states for different scenarios"
echo ""
echo "For this demo, we'll use the generated config as-is"
echo ""

# Step 4: Import OpenAPI to generate data file
echo -e "${GREEN}Step 4: Import OpenAPI to create data file${NC}"
echo "Command: mockprox-cli import --input $OPENAPI_SPEC --output $DATA_FILE"
cd "$CLI_PATH"
node ./bin/dev.js import --input ./test/pokeapi.openapi.yml --output ./test/demo-data.json
cd ../..
echo ""

# Step 5: Start server with config
echo -e "${GREEN}Step 5: Start mock server with config${NC}"
echo "Command: mockprox-cli start --data $DATA_FILE --config $CONFIG_FILE --port $PORT"
echo ""
echo -e "${YELLOW}Server will start in background...${NC}"
cd "$CLI_PATH"
node ./bin/dev.js start --data ./test/demo-data.json --config ./test/demo-config.json --port $PORT &
SERVER_PID=$!
cd ../..
echo "Server PID: $SERVER_PID"
echo ""

# Wait for server to start
echo "Waiting for server to start..."
sleep 5
echo ""

# Step 6: Test endpoints
echo -e "${GREEN}Step 6: Test endpoints with state switching${NC}"
echo ""

# Test default state
echo -e "${BLUE}Test 1: Request with default state (success)${NC}"
echo "Command: curl -s http://localhost:$PORT/ability"
curl -s "http://localhost:$PORT/ability" | head -20
echo "..."
echo ""

# Test with explicit success state
echo -e "${BLUE}Test 2: Request with explicit success state${NC}"
echo "Command: curl -s http://localhost:$PORT/ability?state=success"
curl -s "http://localhost:$PORT/ability?state=success" | head -20
echo "..."
echo ""

# Test with fail state
echo -e "${BLUE}Test 3: Request with fail state${NC}"
echo "Command: curl -s http://localhost:$PORT/ability?state=fail"
curl -s "http://localhost:$PORT/ability?state=fail" | head -20
echo "..."
echo ""

# Cleanup
echo -e "${YELLOW}Stopping server (PID: $SERVER_PID)...${NC}"
kill $SERVER_PID 2>/dev/null || true
sleep 2
echo ""

# Summary
echo "=========================================="
echo -e "${GREEN}Demo Complete!${NC}"
echo "=========================================="
echo ""
echo "Summary:"
echo "  ✅ Generated config from OpenAPI spec"
echo "  ✅ Config includes property overrides and response states"
echo "  ✅ Started server with unified config"
echo "  ✅ Tested endpoints with state switching"
echo ""
echo "Key Features Demonstrated:"
echo "  - generate-config command creates intelligent defaults"
echo "  - Config consolidates data generation + response states + faker factories"
echo "  - State switching via query parameter (?state=success|fail)"
echo "  - Backward compatible (--config is optional)"
echo ""
echo "Next Steps:"
echo "  - Edit $CONFIG_FILE to customize behavior"
echo "  - Add more response states (e.g., slow, timeout)"
echo "  - Define specific property overrides for your use case"
echo "  - Integrate with your test suite"
echo ""
echo "Files created during demo:"
echo "  - $CONFIG_FILE (unified config)"
echo "  - $DATA_FILE (mock data)"
echo ""
