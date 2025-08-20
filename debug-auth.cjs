#!/usr/bin/env node

// Debug script to test authentication endpoints
const http = require('http');

function makeRequest(options, data = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: body
        });
      });
    });
    
    req.on('error', reject);
    
    if (data) {
      req.write(data);
    }
    req.end();
  });
}

async function testAuth() {
  console.log('Testing Azure DevOps MCP Server Authentication...\n');

  // Test 1: Health check
  console.log('1. Testing health endpoint...');
  try {
    const health = await makeRequest({
      hostname: 'localhost',
      port: 3000,
      path: '/health',
      method: 'GET'
    });
    console.log(`   Status: ${health.statusCode}`);
    console.log(`   Body: ${health.body}\n`);
  } catch (error) {
    console.log(`   Error: ${error.message}\n`);
  }

  // Test 2: No auth header
  console.log('2. Testing /mcp without auth header...');
  try {
    const noAuth = await makeRequest({
      hostname: 'localhost',
      port: 3000,
      path: '/mcp',
      method: 'GET'
    });
    console.log(`   Status: ${noAuth.statusCode}`);
    console.log(`   Body: ${noAuth.body}\n`);
  } catch (error) {
    console.log(`   Error: ${error.message}\n`);
  }

  // Test 3: Invalid auth header format
  console.log('3. Testing /mcp with invalid auth header format...');
  try {
    const invalidAuth = await makeRequest({
      hostname: 'localhost',
      port: 3000,
      path: '/mcp',
      method: 'GET',
      headers: {
        'Authorization': 'Invalid format'
      }
    });
    console.log(`   Status: ${invalidAuth.statusCode}`);
    console.log(`   Body: ${invalidAuth.body}\n`);
  } catch (error) {
    console.log(`   Error: ${error.message}\n`);
  }

  // Test 4: Valid format but fake token
  console.log('4. Testing /mcp with Bearer token but no org header...');
  try {
    const fakeToken = await makeRequest({
      hostname: 'localhost',
      port: 3000,
      path: '/mcp',
      method: 'GET',
      headers: {
        'Authorization': 'Bearer fake-token-12345'
      }
    });
    console.log(`   Status: ${fakeToken.statusCode}`);
    console.log(`   Body: ${fakeToken.body}\n`);
  } catch (error) {
    console.log(`   Error: ${error.message}\n`);
  }

  // Test 5: Valid format with org header but fake token
  console.log('5. Testing /mcp with Bearer token and org header (fake token)...');
  try {
    const withOrg = await makeRequest({
      hostname: 'localhost',
      port: 3000,
      path: '/mcp',
      method: 'GET',
      headers: {
        'Authorization': 'Bearer fake-token-12345',
        'x-ado-organization': 'contoso'
      }
    });
    console.log(`   Status: ${withOrg.statusCode}`);
    console.log(`   Body: ${withOrg.body}\n`);
  } catch (error) {
    console.log(`   Error: ${error.message}\n`);
  }

  console.log('Debug complete. If you get "Missing or invalid Authorization header"');
  console.log('even with a proper Bearer token, there might be an issue with header parsing.');
}

testAuth().catch(console.error);