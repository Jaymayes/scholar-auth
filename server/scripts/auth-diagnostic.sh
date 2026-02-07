#!/bin/bash
###############################################################################
# One-Command Auth Diagnostic Script
# Purpose: Validate scope claim across single/multiple scopes and report
#          issuer/audience for drift detection
# Usage: ./auth-diagnostic.sh [environment]
#   environment: local (default) | staging | production
###############################################################################

set -e

# Configuration
ENVIRONMENT="${1:-local}"

case "$ENVIRONMENT" in
  local)
    ISSUER="http://localhost:5000/oidc"
    ;;
  staging)
    ISSUER="https://staging-scholar-auth.replit.app/oidc"
    ;;
  production)
    ISSUER="https://scholar-auth-jamarrlmayes.replit.app/oidc"
    ;;
  *)
    echo "❌ Invalid environment: $ENVIRONMENT (use: local, staging, production)"
    exit 1
    ;;
esac

TOKEN_ENDPOINT="${ISSUER}/token"
JWKS_ENDPOINT="${ISSUER}/jwks"

echo "🔍 Auth Diagnostic Report"
echo "=================================="
echo "Environment: $ENVIRONMENT"
echo "Issuer: $ISSUER"
echo "Timestamp: $(date -u +"%Y-%m-%d %H:%M:%S UTC")"
echo ""

# Test 1: Single scope
echo "📋 Test 1: Single Scope Request"
echo "--------------------------------"
RESPONSE=$(curl -s -X POST "$TOKEN_ENDPOINT" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials" \
  -d "client_id=scholarship-sage-m2m" \
  -d "client_secret=${M2M_SCHOLARSHIP_SAGE_SECRET}" \
  -d "scope=read:scholarships" \
  -d "resource=urn:scholar-platform")

if [ $? -ne 0 ]; then
  echo "❌ FAIL: Token request failed"
  exit 1
fi

ACCESS_TOKEN=$(echo "$RESPONSE" | jq -r '.access_token // empty')

if [ -z "$ACCESS_TOKEN" ]; then
  echo "❌ FAIL: No access token received"
  echo "Response: $RESPONSE"
  exit 1
fi

# Decode JWT payload
PAYLOAD=$(echo "$ACCESS_TOKEN" | cut -d'.' -f2 | base64 -d 2>/dev/null)

SCOPE=$(echo "$PAYLOAD" | jq -r '.scope // "null"')
ISS=$(echo "$PAYLOAD" | jq -r '.iss')
AUD=$(echo "$PAYLOAD" | jq -r '.aud')
EXP=$(echo "$PAYLOAD" | jq -r '.exp')
IAT=$(echo "$PAYLOAD" | jq -r '.iat')
TTL=$((EXP - IAT))

echo "Requested: read:scholarships"
echo "Received:  $SCOPE"
if [ "$SCOPE" = "read:scholarships" ]; then
  echo "✅ PASS: Scope claim present and correct"
elif [ "$SCOPE" = "null" ]; then
  echo "❌ FAIL: Scope claim missing (null)"
else
  echo "⚠️  WARN: Scope mismatch"
fi
echo ""

# Test 2: Multiple scopes
echo "📋 Test 2: Multiple Scope Request"
echo "--------------------------------"
RESPONSE=$(curl -s -X POST "$TOKEN_ENDPOINT" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials" \
  -d "client_id=scholarship-sage-m2m" \
  -d "client_secret=${M2M_SCHOLARSHIP_SAGE_SECRET}" \
  -d "scope=read:scholarships read:users export:data" \
  -d "resource=urn:scholar-platform")

ACCESS_TOKEN=$(echo "$RESPONSE" | jq -r '.access_token // empty')
PAYLOAD=$(echo "$ACCESS_TOKEN" | cut -d'.' -f2 | base64 -d 2>/dev/null)
SCOPE=$(echo "$PAYLOAD" | jq -r '.scope // "null"')

echo "Requested: read:scholarships read:users export:data"
echo "Received:  $SCOPE"
if [ "$SCOPE" = "read:scholarships read:users export:data" ]; then
  echo "✅ PASS: Multiple scopes present and correct"
elif [ "$SCOPE" = "null" ]; then
  echo "❌ FAIL: Scope claim missing (null)"
else
  echo "⚠️  WARN: Scope mismatch"
fi
echo ""

# Test 3: JWT Standard Claims
echo "📋 Test 3: JWT Standard Claims"
echo "--------------------------------"
echo "Issuer (iss):   $ISS"
echo "Audience (aud): $AUD"
echo "TTL (seconds):  $TTL"

CANONICAL_ISSUER="https://scholar-auth-jamarrlmayes.replit.app/oidc"
if [ "$ISS" = "$CANONICAL_ISSUER" ]; then
  echo "✅ Issuer matches canonical"
else
  echo "⚠️  Issuer drift detected (expected: $CANONICAL_ISSUER)"
fi

if [ "$AUD" = "urn:scholar-platform" ]; then
  echo "✅ Audience correct"
else
  echo "❌ Audience incorrect (expected: urn:scholar-platform)"
fi

if [ "$TTL" -eq 300 ]; then
  echo "✅ TTL correct (300s)"
else
  echo "⚠️  TTL incorrect (expected: 300s, got: ${TTL}s)"
fi
echo ""

# Test 4: JWKS Availability
echo "📋 Test 4: JWKS Endpoint"
echo "--------------------------------"
JWKS=$(curl -s "$JWKS_ENDPOINT")
KEY_COUNT=$(echo "$JWKS" | jq '.keys | length')
ALG=$(echo "$JWKS" | jq -r '.keys[0].alg')

echo "Keys available: $KEY_COUNT"
echo "Algorithm:      $ALG"

if [ "$KEY_COUNT" -ge 1 ] && [ "$ALG" = "RS256" ]; then
  echo "✅ JWKS endpoint healthy"
else
  echo "❌ JWKS endpoint issue detected"
fi
echo ""

# Summary
echo "=================================="
echo "🎯 Diagnostic Summary"
echo "=================================="
echo "Environment:     $ENVIRONMENT"
echo "Issuer:          $ISS"
echo "Audience:        $AUD"
echo "Scope Support:   $([ "$SCOPE" != "null" ] && echo "✅ YES" || echo "❌ NO")"
echo "JWKS Available:  $([ "$KEY_COUNT" -ge 1 ] && echo "✅ YES" || echo "❌ NO")"
echo "TTL Compliant:   $([ "$TTL" -eq 300 ] && echo "✅ YES" || echo "⚠️  NO (${TTL}s)")"
echo "=================================="
