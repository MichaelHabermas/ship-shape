#!/bin/bash
set -euo pipefail

# Ship frontend deploy: S3 + CloudFront for dev, shadow, or prod (canonical AWS web path).
#
# Usage: ./scripts/deploy-web.sh <dev|shadow|prod>
#
# Prerequisites:
#   - AWS CLI configured with appropriate credentials
#   - Terraform outputs available (or DEPLOY_S3_BUCKET / DEPLOY_CF_DISTRIBUTION)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

ENV="${1:-}"
if [[ ! "$ENV" =~ ^(dev|shadow|prod)$ ]]; then
  echo "Usage: $0 <dev|shadow|prod>"
  echo ""
  echo "Examples:"
  echo "  $0 dev     # Deploy to dev environment"
  echo "  $0 shadow  # Deploy to shadow environment (UAT)"
  echo "  $0 prod    # Deploy to prod environment"
  exit 1
fi

if [ "$ENV" = "prod" ]; then
  TF_DIR="$PROJECT_ROOT/terraform"
else
  TF_DIR="$PROJECT_ROOT/terraform/environments/$ENV"
fi

"$SCRIPT_DIR/sync-terraform-config.sh" "$ENV"

echo "=== Ship Frontend Deploy ==="
echo "Environment: $ENV"

S3_BUCKET=""
CF_DISTRIBUTION=""
FRONTEND_URL=""

if [ -d "$TF_DIR" ] && command -v terraform &> /dev/null; then
  S3_BUCKET=$(cd "$TF_DIR" && terraform output -raw s3_bucket_name 2>/dev/null || echo "")
  CF_DISTRIBUTION=$(cd "$TF_DIR" && terraform output -raw cloudfront_distribution_id 2>/dev/null || echo "")
  FRONTEND_URL=$(cd "$TF_DIR" && terraform output -raw frontend_url 2>/dev/null || echo "")
fi

S3_BUCKET="${S3_BUCKET:-${DEPLOY_S3_BUCKET:-}}"
CF_DISTRIBUTION="${CF_DISTRIBUTION:-${DEPLOY_CF_DISTRIBUTION:-}}"

if [ -z "$S3_BUCKET" ]; then
  echo "ERROR: S3_BUCKET not found. Run 'terraform apply' in $TF_DIR directory first."
  exit 1
fi

if [ -z "$CF_DISTRIBUTION" ]; then
  echo "ERROR: CloudFront distribution ID not found."
  exit 1
fi

cd "$PROJECT_ROOT"

echo "Building shared package..."
pnpm build:shared

echo "Building frontend..."
VITE_APP_ENV=production pnpm build:web

echo "Syncing assets to S3: $S3_BUCKET"
aws s3 sync web/dist/ "s3://${S3_BUCKET}/" \
  --delete \
  --exclude "index.html" \
  --cache-control "public,max-age=31536000,immutable"

echo "Uploading index.html with short cache for SPA routing..."
aws s3 cp web/dist/index.html "s3://${S3_BUCKET}/index.html" \
  --cache-control "public,max-age=300"

echo "Invalidating CloudFront cache..."
INVALIDATION_ID=$(aws cloudfront create-invalidation \
  --distribution-id "$CF_DISTRIBUTION" \
  --paths "/*" \
  --query 'Invalidation.Id' \
  --output text)

echo "Invalidation started: $INVALIDATION_ID"

echo "Waiting for invalidation to complete..."
aws cloudfront wait invalidation-completed \
  --distribution-id "$CF_DISTRIBUTION" \
  --id "$INVALIDATION_ID"

echo ""
echo "Frontend deployed to $ENV successfully!"
if [ -n "$FRONTEND_URL" ]; then
  echo "Frontend URL: $FRONTEND_URL"
fi
