#!/bin/bash

# Test script for PAT authentication
# Usage: ./test-pat.sh YOUR_PAT_TOKEN YOUR_ORG_NAME

if [ $# -ne 2 ]; then
    echo "Usage: $0 <PAT_TOKEN> <ORG_NAME>"
    echo "Example: $0 'abcd1234...' 'contoso'"
    exit 1
fi

PAT_TOKEN="$1"
ORG_NAME="$2"

echo "Testing Azure DevOps MCP Server with PAT authentication..."
echo "PAT Token: ${PAT_TOKEN:0:8}... (truncated)"
echo "Organization: $ORG_NAME"
echo ""

# Test 1: Health check
echo "1. Testing health endpoint..."
curl -s http://localhost:3000/health | jq . 2>/dev/null || echo "Health check failed"
echo ""

# Test 2: Info endpoint
echo "2. Testing info endpoint..."
curl -s http://localhost:3000/info | jq . 2>/dev/null || echo "Info check failed"
echo ""

# Test 3: MCP endpoint with PAT
echo "3. Testing MCP endpoint with PAT token..."
echo "Command: curl -H \"Authorization: Bearer \$PAT_TOKEN\" -H \"x-ado-organization: $ORG_NAME\" http://localhost:3000/mcp"
echo ""

# Use timeout to prevent hanging on successful SSE connection
echo "Testing authentication (with 5 second timeout)..."
response=$(timeout 5 curl -s -H "Authorization: Bearer $PAT_TOKEN" -H "x-ado-organization: $ORG_NAME" http://localhost:3000/mcp 2>&1)
exit_code=$?

echo "Response:"
echo "$response"
echo ""

# Check the result
if [ $exit_code -eq 124 ]; then
    echo "✅ SUCCESS! Connection timed out after 5 seconds."
    echo "   This means your PAT authentication is working correctly!"
    echo "   The MCP server opened an SSE connection and was waiting for MCP protocol messages."
elif echo "$response" | grep -q "error"; then
    echo "❌ Authentication failed. Response contains error."
    if echo "$response" | grep -q "Invalid Personal Access Token"; then
        echo "   Your PAT token is either invalid, expired, or doesn't have the required scopes."
    elif echo "$response" | grep -q "Missing or invalid Authorization header"; then
        echo "   There's an issue with the header format. Check for special characters or spaces."
    fi
else
    echo "⚠️  Unexpected response. Check the output above."
fi

echo ""
echo "If you get 'Missing or invalid Authorization header' even with proper format:"
echo "1. Check that your PAT token doesn't have any special characters that need escaping"
echo "2. Try wrapping the token in single quotes: 'your-token-here'"
echo "3. Make sure there are no trailing spaces in your token"
echo "4. Verify your organization name is correct"