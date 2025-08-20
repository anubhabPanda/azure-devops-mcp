#!/usr/bin/env python3
"""
SmolagAgents MCP HTTP Client Test
Test connecting SmolagAgents to Azure DevOps MCP HTTP Server using streamable HTTP transport
"""

import os
import requests
import json
from typing import Dict, Any

# Configuration - Set these environment variables
PAT_TOKEN = os.environ.get('AZURE_DEVOPS_PAT', '')
ORG_NAME = os.environ.get('AZURE_DEVOPS_ORG_NAME', '')
SERVER_URL = os.environ.get('MCP_SERVER_URL', 'http://localhost:3000')

try:
    from smolagents import MCPClient
    SMOLAGENTS_AVAILABLE = True
except ImportError:
    print("⚠️  SmolagAgents not installed. Install with: pip install smolagents")
    SMOLAGENTS_AVAILABLE = False

def test_smolagents_streamable_http():
    """Test SmolagAgents with streamable HTTP transport"""
    if not SMOLAGENTS_AVAILABLE:
        print("❌ SmolagAgents not available. Cannot test streamable HTTP.")
        return False
    
    print("\n" + "="*60)
    print("🚀 Testing SmolagAgents with Streamable HTTP Transport")
    print("="*60)
    
    # Check environment variables
    if not PAT_TOKEN or not ORG_NAME:
        print("❌ Missing required environment variables!")
        print("Please set:")
        print("  export AZURE_DEVOPS_PAT='your-pat-token'")
        print("  export AZURE_DEVOPS_ORG_NAME='your-org-name'")
        return False
    
    # Try multiple configuration approaches
    config_approaches = [
        {
            "name": "Method 1: Basic config with headers dict",
            "config": {
                "url": f"{SERVER_URL}/mcp",
                "transport": "streamable-http",
                "headers": {
                    "Authorization": f"Bearer {PAT_TOKEN}",
                    "x-ado-organization": ORG_NAME
                }
            }
        }
    ]
    
    for i, approach in enumerate(config_approaches, 1):
        print(f"\n{i}. Testing {approach['name']}...")
        try:
            if approach.get("use_tool_collection"):
                # Try ToolCollection approach (may not support headers directly)
                try:
                    from smolagents import ToolCollection
                    print("   Using ToolCollection.from_mcp...")
                    with ToolCollection.from_mcp(approach["config"], trust_remote_code=True) as tool_collection:
                        print(f"   ✅ Connected with {len(tool_collection.tools)} tools")
                        return True
                except Exception as e:
                    print(f"   ⚠️  ToolCollection approach failed: {e}")
                    continue
            else:
                # Standard MCPClient approach
                mcp_config = approach["config"]
                print(f"   Config: {mcp_config}")
                
                with MCPClient(mcp_config) as tools:
                    print(f"   ✅ Connected to MCP server with {len(tools)} tools available")
                    print("   Available tools:", [x.name for x in tools])
                
                print("   ✅ SmolagAgents streamable HTTP test completed successfully!")
                return True
                
        except Exception as e:
            print(f"   ❌ {approach['name']} failed: {e}")
            print(f"      Error type: {type(e).__name__}")
            if hasattr(e, '__cause__') and e.__cause__:
                print(f"      Caused by: {e.__cause__}")
            continue
    
    print(f"\n❌ All configuration approaches failed")
    return False

def test_smolagents_manual_connection():
    """Test SmolagAgents with manual connection management"""
    if not SMOLAGENTS_AVAILABLE:
        print("❌ SmolagAgents not available.")
        return False
    
    print("\n" + "="*60)
    print("🔧 Testing SmolagAgents with Manual Connection Management")
    print("="*60)
    
    mcp_client = None
    try:
        # Manual connection management
        mcp_config = {
            "url": f"{SERVER_URL}/mcp", 
            "transport": "streamable-http",
            "headers": {
                "Authorization": f"Bearer {PAT_TOKEN}",
                "x-ado-organization": ORG_NAME
            }
        }
        
        mcp_client = MCPClient(mcp_config)
        tools = mcp_client.get_tools()
        tool_names = [tool.name for tool in tools]
        print(f"✅ Manually connected to MCP server with {len(tools)} tools")
        
        # Test a few tools
        test_tools = ["core_list_projects", "wit_my_work_items", "core_list_project_teams"]
        for tool_name in test_tools:
            if tool_name in tool_name:
                print(f"   ✅ Tool available: {tool_name}")
            else:
                print(f"   ❌ Tool not found: {tool_name}")
        
        # Test a specific tool
        print("\nTesting specific tool: wit_get_work_item")
        get_wit = [x for x in tools if x.name == "wit_get_work_item"][0]
        feature_details = get_wit(id=741532, project="IS7", expand="all")
        print("✅ Retrieved work item details:", feature_details)
        return True
        
    except Exception as e:
        print(f"❌ Manual connection test failed: {e}")
        return False
    finally:
        if mcp_client:
            try:
                mcp_client.disconnect()
                print("✅ Disconnected from MCP server")
            except Exception as e:
                print(f"⚠️  Disconnect warning: {e}")

if __name__ == "__main__":
    print("🚀 Azure DevOps MCP Server - SmolagAgents Integration Test")
    print("="*65)
    
    # # Test 1: Basic HTTP connection (fallback method)
    # print("\n📡 Test 1: Basic HTTP Bridge Connection")
    # basic_success = test_mcp_connection()
    
    # # Test 2: Direct MCP SDK (most direct approach)
    # print("\n🎯 Test 2: Direct MCP SDK with streamablehttp_client")
    # direct_success = test_mcp_sdk_direct()
    
    # Test 3: SmolagAgents streamable HTTP (preferred method)  
    print("\n🚀 Test 3: SmolagAgents Streamable HTTP Transport")
    streamable_success = test_smolagents_streamable_http()
    
    # Test 4: SmolagAgents manual connection management
    print("\n🔧 Test 4: SmolagAgents Manual Connection Management") 
    manual_success = test_smolagents_manual_connection()
    
    # Summary
    print("\n" + "="*65)
    print("📊 TEST SUMMARY")
    print("="*65)
    # print(f"Basic HTTP Bridge:     {'✅ PASS' if basic_success else '❌ FAIL'}")
    # print(f"Direct MCP SDK:        {'✅ PASS' if direct_success else '❌ FAIL'}")
    print(f"Streamable HTTP:       {'✅ PASS' if streamable_success else '❌ FAIL'}")
    print(f"Manual Connection:     {'✅ PASS' if manual_success else '❌ FAIL'}")
    
    if streamable_success:
        print(f"\n🎉 SUCCESS! Use SmolagAgents streamable HTTP transport:")
        print(f"""
# Recommended SmolagAgents integration:
from smolagents import MCPClient

mcp_config = {{
    "url": "{SERVER_URL}/mcp",
    "transport": "streamable-http", 
    "headers": {{
        "Authorization": "Bearer YOUR_PAT_TOKEN",
        "x-ado-organization": "YOUR_ORG_NAME"
    }}
}}

# Context manager approach (recommended)
with MCPClient(mcp_config) as tools:
    projects = tools["core_list_projects"]()
    work_items = tools["wit_my_work_items"]()

# Or manual approach  
mcp_client = MCPClient(mcp_config)
try:
    tools = mcp_client.get_tools()
    # use tools...
finally:
    mcp_client.disconnect()
        """)
    # elif direct_success:
    #     print(f"\n✅ Direct MCP SDK works! SmolagAgents may need header configuration fixes.")
    #     print(f"You can use the direct MCP SDK approach or wait for SmolagAgents updates.")
    # elif basic_success:
    #     print(f"\n⚠️  SmolagAgents streamable HTTP not working, but basic HTTP bridge works.")
    #     print(f"You can use the HttpMCPBridge class as a workaround.")
    else:
        print(f"\n❌ All tests failed. Check your server and configuration.")
        print(f"Make sure:")
        print(f"1. Docker server is running: docker-compose -f docker-compose.basic.yml up -d")
        print(f"2. Environment variables are set: AZURE_DEVOPS_PAT, AZURE_DEVOPS_ORG_NAME") 
        print(f"3. PAT token has correct permissions")
        print(f"4. Server is accessible at {SERVER_URL}")