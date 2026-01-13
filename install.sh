#!/bin/bash

# Ethereum MCP Installer
# https://github.com/ETHCF/ethereum-mcp

set -e

INSTALL_DIR="$HOME/.ethereum-mcp"
CLAUDE_CODE_CONFIG="$HOME/.claude.json"
CLAUDE_DESKTOP_CONFIG="$HOME/Library/Application Support/Claude/claude_desktop_config.json"

# Initialize API key variables
ETHERSCAN_KEY=""
DUNE_KEY=""

echo ""
echo "⬙ Ethereum MCP Installer"
echo ""

# Check for node
if ! command -v node &> /dev/null; then
    echo "Error: Node.js is required. Install it from https://nodejs.org"
    exit 1
fi

# Check for npm
if ! command -v npm &> /dev/null; then
    echo "Error: npm is required. Install Node.js from https://nodejs.org"
    exit 1
fi

# Clone or update
if [ -d "$INSTALL_DIR" ]; then
    echo "Updating existing installation..."
    cd "$INSTALL_DIR"
    git pull origin main
else
    echo "Cloning repository..."
    git clone https://github.com/ETHCF/ethereum-mcp.git "$INSTALL_DIR"
    cd "$INSTALL_DIR"
fi

# Install and build
echo "Installing dependencies..."
npm install --silent

echo "Building..."
npm run build --silent

# Check for existing API keys in Claude config
EXISTING_ETHERSCAN=""
EXISTING_DUNE=""

check_existing_keys() {
    local config_file="$1"
    if [ -f "$config_file" ]; then
        EXISTING_ETHERSCAN=$(node -e "
            const fs = require('fs');
            try {
                const config = JSON.parse(fs.readFileSync('$config_file', 'utf8'));
                const key = config?.mcpServers?.ethereum?.env?.ETHERSCAN_API_KEY || '';
                if (key && key !== 'your-key-here') console.log(key);
            } catch(e) {}
        " 2>/dev/null)
        EXISTING_DUNE=$(node -e "
            const fs = require('fs');
            try {
                const config = JSON.parse(fs.readFileSync('$config_file', 'utf8'));
                const key = config?.mcpServers?.ethereum?.env?.DUNE_API_KEY || '';
                console.log(key);
            } catch(e) {}
        " 2>/dev/null)
    fi
}

# Check existing config
if [ -f "$CLAUDE_CODE_CONFIG" ]; then
    check_existing_keys "$CLAUDE_CODE_CONFIG"
elif [ -f "$CLAUDE_DESKTOP_CONFIG" ]; then
    check_existing_keys "$CLAUDE_DESKTOP_CONFIG"
fi

# Ask for API keys (read from /dev/tty to work with curl | bash)
echo ""
echo "API Keys (optional but recommended — both are free):"
echo ""

if [ -n "$EXISTING_ETHERSCAN" ]; then
    echo "Etherscan key: ✓ Already configured (${EXISTING_ETHERSCAN:0:8}...)"
    ETHERSCAN_KEY="$EXISTING_ETHERSCAN"
else
    printf "Etherscan key (unlocks balances, transactions, gas): "
    read ETHERSCAN_KEY < /dev/tty
fi

if [ -n "$EXISTING_DUNE" ]; then
    echo "Dune key: ✓ Already configured (${EXISTING_DUNE:0:8}...)"
    DUNE_KEY="$EXISTING_DUNE"
else
    printf "Dune key (unlocks custom SQL queries on any chain): "
    read DUNE_KEY < /dev/tty
fi

echo ""
if [ -z "$ETHERSCAN_KEY" ] && [ -z "$DUNE_KEY" ]; then
    echo "No keys entered. You can add them later in ~/.claude.json"
    echo "Get free keys at: etherscan.io/apis and dune.com/settings/api"
fi

# Function to add config using node (handles JSON properly)
add_config() {
    local config_file="$1"

    node -e "
const fs = require('fs');
const configPath = '$config_file';
const installDir = '$INSTALL_DIR';
const etherscanKey = '$ETHERSCAN_KEY';
const duneKey = '$DUNE_KEY';

let config = {};
if (fs.existsSync(configPath)) {
    try {
        config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch (e) {
        console.error('Warning: Could not parse existing config, creating new one');
    }
}

if (!config.mcpServers) {
    config.mcpServers = {};
}

const env = {};
if (etherscanKey) env.ETHERSCAN_API_KEY = etherscanKey;
if (duneKey) env.DUNE_API_KEY = duneKey;

config.mcpServers.ethereum = {
    command: 'node',
    args: [installDir + '/dist/index.js'],
    env: env
};

fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
console.log('✓ Config added to ' + configPath);
"
}

# Detect and configure Claude
if [ -f "$CLAUDE_CODE_CONFIG" ]; then
    echo ""
    echo "Detected: Claude Code"
    # Backup existing config
    cp "$CLAUDE_CODE_CONFIG" "$CLAUDE_CODE_CONFIG.backup"
    add_config "$CLAUDE_CODE_CONFIG"
    echo ""
    echo "⬙ Restart Claude Code, then say \"talk to ethereum\""
    echo ""
elif [ -f "$CLAUDE_DESKTOP_CONFIG" ]; then
    echo ""
    echo "Detected: Claude Desktop"
    # Backup existing config
    cp "$CLAUDE_DESKTOP_CONFIG" "$CLAUDE_DESKTOP_CONFIG.backup"
    add_config "$CLAUDE_DESKTOP_CONFIG"
    echo ""
    echo "⬙ Restart Claude Desktop, then say \"talk to ethereum\""
    echo ""
else
    # No Claude config found - create Claude Code config
    echo ""
    echo "No existing Claude config found. Creating ~/.claude.json..."
    add_config "$CLAUDE_CODE_CONFIG"
    echo ""
    echo "⬙ Start Claude Code, then say \"talk to ethereum\""
    echo ""
fi
