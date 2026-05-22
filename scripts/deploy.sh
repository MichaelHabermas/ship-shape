#!/bin/bash
set -euo pipefail

# Ship API Deployment Script
# Deploys the API to Elastic Beanstalk for the specified environment
#
# Usage: ./scripts/deploy.sh [--bootstrap-infra] <dev|shadow|prod>
#
# Infrastructure bootstrap (terraform apply) is opt-in only:
#   ./scripts/deploy.sh --bootstrap-infra prod
#   DEPLOY_BOOTSTRAP_INFRA=1 ./scripts/deploy.sh prod
#
# Prerequisites:
#   - AWS CLI configured with appropriate credentials
#   - Terraform infrastructure deployed for the target environment
#
# New Developer Setup:
#   All configuration is stored in AWS SSM Parameter Store. After configuring
#   AWS CLI credentials, this script pulls everything it needs from SSM:
#
#   Terraform Config (auto-pulled by sync-terraform-config.sh):
#     /ship/terraform-config/{env}/environment
#     /ship/terraform-config/{env}/app_domain_name
#     /ship/terraform-config/{env}/route53_zone_id
#     /ship/terraform-config/{env}/eb_environment_cname
#
#   App Runtime (loaded by api/src/config/ssm.ts in production):
#     /ship/{env}/DATABASE_URL        - PostgreSQL connection string
#     /ship/{env}/SESSION_SECRET      - Express session secret
#     /ship/{env}/CORS_ORIGIN         - Allowed CORS origin
#     /ship/{env}/CDN_DOMAIN          - CloudFront domain for assets
#     /ship/{env}/APP_BASE_URL        - Frontend app URL
#
#   Secrets Manager (for OAuth - configured via configure-caia.sh):
#     /ship/{env}/caia-credentials    - JSON with issuer_url, client_id, client_secret
#
#   To bootstrap a new environment, see terraform/README.md
#
# IMPORTANT: Do not make infrastructure changes directly with AWS CLI.
# All changes must go through Terraform or this script to ensure they're
# captured for the next developer. See /workflows:deploy for details.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Parse arguments
BOOTSTRAP_INFRA=false
ENV=""

for arg in "$@"; do
  case "$arg" in
    --bootstrap-infra)
      BOOTSTRAP_INFRA=true
      ;;
    dev|shadow|prod)
      if [ -n "$ENV" ]; then
        echo "ERROR: Multiple environments specified: $ENV and $arg"
        exit 1
      fi
      ENV="$arg"
      ;;
    *)
      echo "ERROR: Unknown argument: $arg"
      echo "Usage: $0 [--bootstrap-infra] <dev|shadow|prod>"
      exit 1
      ;;
  esac
done

if [[ "${DEPLOY_BOOTSTRAP_INFRA:-}" == "1" ]]; then
  BOOTSTRAP_INFRA=true
fi

if [[ ! "$ENV" =~ ^(dev|shadow|prod)$ ]]; then
  echo "Usage: $0 [--bootstrap-infra] <dev|shadow|prod>"
  echo ""
  echo "Examples:"
  echo "  $0 dev     # Deploy to dev environment"
  echo "  $0 shadow  # Deploy to shadow environment (UAT)"
  echo "  $0 prod    # Deploy to prod environment"
  echo ""
  echo "Bootstrap missing infrastructure (terraform apply):"
  echo "  $0 --bootstrap-infra prod"
  echo "  DEPLOY_BOOTSTRAP_INFRA=1 $0 prod"
  exit 1
fi

# Environment-specific configuration
# - prod uses existing terraform at root with original app name (ship-api)
# - dev/shadow use new modular structure with environment-suffixed app name
if [ "$ENV" = "prod" ]; then
  TF_DIR="$PROJECT_ROOT/terraform"
  APP_NAME="ship-api"
  ENV_NAME="ship-api-prod"
else
  # dev and shadow both use the modular terraform structure
  TF_DIR="$PROJECT_ROOT/terraform/environments/$ENV"
  APP_NAME="ship-api-${ENV}"
  ENV_NAME="ship-api-${ENV}"
fi

# Sync terraform config from SSM (source of truth for this environment)
"$SCRIPT_DIR/sync-terraform-config.sh" "$ENV"

VERSION="v$(date +%Y%m%d%H%M%S)"

# Get S3 bucket from Terraform outputs
if [ -d "$TF_DIR" ] && command -v terraform &> /dev/null; then
  S3_BUCKET=$(cd "$TF_DIR" && terraform output -raw s3_bucket_name 2>/dev/null || echo "")
fi
S3_BUCKET="${S3_BUCKET:-${DEPLOY_S3_BUCKET:-}}"

if [ -z "$S3_BUCKET" ]; then
  if [ "$BOOTSTRAP_INFRA" != true ]; then
    echo "ERROR: S3 deployment bucket not found in Terraform outputs for '$ENV'."
    echo ""
    echo "Application deploy does not modify infrastructure automatically."
    echo ""
    echo "Fix options:"
    echo "  1. Provision infrastructure first (see terraform/README.md), then re-run deploy"
    echo "  2. Set DEPLOY_S3_BUCKET to an existing Elastic Beanstalk deployment bucket"
    echo "  3. Opt in to bootstrap: $0 --bootstrap-infra $ENV"
    echo "     (or DEPLOY_BOOTSTRAP_INFRA=1 $0 $ENV)"
    exit 1
  fi

  echo "S3 bucket not found in Terraform outputs. Bootstrapping infrastructure..."
  cd "$TF_DIR"

  # Get state bucket from SSM for backend config
  TF_STATE_BUCKET=$(aws ssm get-parameter --name /ship/terraform-state-bucket --query Parameter.Value --output text)
  terraform init -upgrade -backend-config="bucket=$TF_STATE_BUCKET"
  terraform apply -auto-approve
  S3_BUCKET=$(terraform output -raw s3_bucket_name)
  cd "$PROJECT_ROOT"

  if [ -z "$S3_BUCKET" ]; then
    echo "ERROR: S3_BUCKET still not found after terraform apply"
    exit 1
  fi
fi

echo "=== Ship API Deploy ==="
echo "Environment: $ENV"
echo "Version: $VERSION"
echo "EB Environment: $ENV_NAME"

# ALWAYS rebuild for 100% reliable deploys
# The api/package.json build script copies SQL files automatically
echo "Building..."
cd "$PROJECT_ROOT"
rm -rf shared/dist shared/tsconfig.tsbuildinfo api/dist api/tsconfig.tsbuildinfo
pnpm build:shared && pnpm build:api

# Verify SQL files are present (fail fast if missing)
if [ ! -f "api/dist/db/schema.sql" ]; then
  echo "ERROR: schema.sql not found in api/dist/db/"
  exit 1
fi
if [ ! -d "api/dist/db/migrations" ]; then
  echo "ERROR: migrations directory not found in api/dist/db/"
  exit 1
fi

# Verify all migrations were copied (compare counts)
SRC_COUNT=$(ls -1 api/src/db/migrations/*.sql 2>/dev/null | wc -l | tr -d ' ')
DIST_COUNT=$(ls -1 api/dist/db/migrations/*.sql 2>/dev/null | wc -l | tr -d ' ')
if [ "$SRC_COUNT" != "$DIST_COUNT" ]; then
  echo "ERROR: Migration count mismatch! src=$SRC_COUNT, dist=$DIST_COUNT"
  exit 1
fi
echo "✓ SQL files verified ($DIST_COUNT migrations)"

# CRITICAL: Test Docker build BEFORE deploying
# This catches dependency issues that only manifest in production (--prod install)
echo "Testing Docker build locally..."
if ! docker build -t ship-api:pre-deploy-test . --quiet 2>/dev/null; then
  echo ""
  echo "============================================"
  echo "ERROR: Docker build FAILED"
  echo "============================================"
  echo "This would have crashed production!"
  echo ""
  echo "Common causes:"
  echo "  - Dependency in devDependencies that should be in dependencies"
  echo "  - Missing package in package.json"
  echo "  - Dockerfile syntax error"
  echo ""
  echo "Debug: docker build -t ship-api:debug ."
  echo "============================================"
  exit 1
fi

# Verify container can start and imports work
# Provide minimal env vars for import test (actual values come from EB environment)
# Note: app.js starts Express server so we explicitly exit(0) after import succeeds
echo "Verifying container starts..."
IMPORT_TEST=$(docker run --rm \
  -e SESSION_SECRET=test-secret-for-import-check \
  -e DATABASE_URL=postgres://test:test@localhost/test \
  ship-api:pre-deploy-test node -e "
  import('./dist/app.js')
    .then(() => { console.log('OK'); process.exit(0); })
    .catch(e => { console.error('FAIL:', e.message); process.exit(1); })
" 2>&1)

if [ "$IMPORT_TEST" != "OK" ]; then
  echo ""
  echo "============================================"
  echo "ERROR: Container failed to start"
  echo "============================================"
  echo "$IMPORT_TEST"
  echo ""
  echo "The container built but crashed on import."
  echo "This usually means a runtime dependency is missing."
  echo ""
  echo "Debug: docker run -it ship-api:pre-deploy-test sh"
  echo "============================================"
  exit 1
fi
echo "✓ Docker build and import test passed"

# Create deployment bundle
# Dockerfile is at repo root, EB finds it automatically
BUNDLE="/tmp/api-${VERSION}.zip"
zip -r "$BUNDLE" \
  Dockerfile \
  package.json \
  pnpm-lock.yaml \
  pnpm-workspace.yaml \
  api/dist \
  api/package.json \
  shared/dist \
  shared/package.json \
  -x "*.git*"

# Add .ebextensions and .platform at root level (EB expects them at root, not under api/)
if [ -d "api/.ebextensions" ]; then
  echo "Adding .ebextensions to bundle..."
  (cd api && zip -r "$BUNDLE" .ebextensions)
fi
if [ -d "api/.platform" ]; then
  echo "Adding .platform to bundle..."
  (cd api && zip -r "$BUNDLE" .platform)
fi

echo "Bundle: $BUNDLE"
echo "Contents:"
unzip -l "$BUNDLE" | grep -E "^Archive|Dockerfile|package.json" | head -10

# Upload and deploy
aws s3 cp "$BUNDLE" "s3://${S3_BUCKET}/deploy/api-${VERSION}.zip"

aws elasticbeanstalk create-application-version \
  --application-name "$APP_NAME" \
  --version-label "$VERSION" \
  --source-bundle S3Bucket="$S3_BUCKET",S3Key="deploy/api-${VERSION}.zip" \
  --no-cli-pager

aws elasticbeanstalk update-environment \
  --environment-name "$ENV_NAME" \
  --version-label "$VERSION" \
  --no-cli-pager

echo ""
echo "Deployed $VERSION to $ENV_NAME"
echo "Monitor: aws elasticbeanstalk describe-environments --environment-names $ENV_NAME --query 'Environments[0].[Health,HealthStatus]'"
