#!/bin/bash
set -euo pipefail

echo "=========================================="
echo "Ship - API Deployment"
echo "=========================================="
echo ""

# Get the project root directory
PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_ROOT"

# Configuration
APP_NAME="${EB_APP_NAME:-ship-api}"
ENV_NAME="${EB_ENV_NAME:-ship-api-dev}"
S3_BUCKET="${EB_S3_BUCKET:-}"
AWS_REGION="${AWS_REGION:-us-east-1}"
VERSION_LABEL="ship-api-$(date +%Y%m%d-%H%M%S)"

# Check if AWS CLI is installed
if ! command -v aws &> /dev/null; then
    echo "Error: AWS CLI is not installed"
    echo "Install with: brew install awscli"
    exit 1
fi

# Check if pnpm is installed
if ! command -v pnpm &> /dev/null; then
    echo "Error: pnpm is not installed"
    echo "Install with: npm install -g pnpm"
    exit 1
fi

# Find S3 bucket if not specified
if [ -z "$S3_BUCKET" ]; then
    echo "Looking for EB S3 bucket..."
    S3_BUCKET=$(aws s3api list-buckets --query "Buckets[?starts_with(Name, 'elasticbeanstalk-${AWS_REGION}')].Name | [0]" --output text 2>/dev/null || true)

    if [ -z "$S3_BUCKET" ] || [ "$S3_BUCKET" = "None" ]; then
        echo "Error: Could not find Elastic Beanstalk S3 bucket"
        echo "Set EB_S3_BUCKET environment variable or ensure EB is configured"
        exit 1
    fi
    echo "Found bucket: $S3_BUCKET"
fi

echo ""
echo "Step 1: Building shared package..."
echo "-----------------------------------"
cd "$PROJECT_ROOT/shared"
pnpm build
echo "Shared package built successfully"

echo ""
echo "Step 2: Building API package..."
echo "-----------------------------------"
cd "$PROJECT_ROOT/api"
pnpm build
echo "API package built successfully"

echo ""
echo "Step 3: Creating deployment package..."
echo "-----------------------------------"

# Create temporary directory for deployment package
DEPLOY_DIR=$(mktemp -d)
trap "rm -rf $DEPLOY_DIR" EXIT

# Copy Dockerfile to root (required by EB Docker platform)
cp "$PROJECT_ROOT/Dockerfile" "$DEPLOY_DIR/Dockerfile"

# Copy root package files
cp "$PROJECT_ROOT/package.json" "$DEPLOY_DIR/"
cp "$PROJECT_ROOT/pnpm-lock.yaml" "$DEPLOY_DIR/"
cp "$PROJECT_ROOT/pnpm-workspace.yaml" "$DEPLOY_DIR/"

# Create directory structure and copy built packages
mkdir -p "$DEPLOY_DIR/api/dist"
mkdir -p "$DEPLOY_DIR/shared/dist"

# Copy api package.json and built dist
cp "$PROJECT_ROOT/api/package.json" "$DEPLOY_DIR/api/"
cp -r "$PROJECT_ROOT/api/dist/"* "$DEPLOY_DIR/api/dist/"

# Copy shared package.json and built dist
cp "$PROJECT_ROOT/shared/package.json" "$DEPLOY_DIR/shared/"
cp -r "$PROJECT_ROOT/shared/dist/"* "$DEPLOY_DIR/shared/dist/"

# Copy vendor dependencies (SDK linked via file: protocol)
mkdir -p "$DEPLOY_DIR/vendor"
cp -r "$PROJECT_ROOT/vendor/"* "$DEPLOY_DIR/vendor/"

# Create the deployment ZIP
ZIP_FILE="$PROJECT_ROOT/deploy-api-${VERSION_LABEL}.zip"
cd "$DEPLOY_DIR"
zip -r "$ZIP_FILE" . -x "*.DS_Store" -x "__MACOSX/*"
echo "Created deployment package: $ZIP_FILE"

echo ""
echo "Step 4: Uploading to S3..."
echo "-----------------------------------"
S3_KEY="$APP_NAME/$VERSION_LABEL.zip"
aws s3 cp "$ZIP_FILE" "s3://$S3_BUCKET/$S3_KEY"
echo "Uploaded to s3://$S3_BUCKET/$S3_KEY"

echo ""
echo "Step 5: Creating application version..."
echo "-----------------------------------"
aws elasticbeanstalk create-application-version \
    --application-name "$APP_NAME" \
    --version-label "$VERSION_LABEL" \
    --source-bundle S3Bucket="$S3_BUCKET",S3Key="$S3_KEY" \
    --region "$AWS_REGION" \
    --no-cli-pager
echo "Created application version: $VERSION_LABEL"

echo ""
echo "Step 6: Deploying to environment..."
echo "-----------------------------------"

# Check if environment exists
ENV_EXISTS=$(aws elasticbeanstalk describe-environments \
    --application-name "$APP_NAME" \
    --environment-names "$ENV_NAME" \
    --query "Environments[?Status!='Terminated'] | length(@)" \
    --output text \
    --region "$AWS_REGION" 2>/dev/null || echo "0")

if [ "$ENV_EXISTS" = "0" ]; then
    echo "Environment does not exist. Creating new environment..."

    VPC_ID=""
    PRIVATE_SUBNETS=""
    PUBLIC_SUBNETS=""
    INSTANCE_SG=""
    INSTANCE_PROFILE=""
    SERVICE_ROLE=""

    # Get Terraform outputs for environment creation
    if [ -d "$PROJECT_ROOT/terraform" ]; then
        cd "$PROJECT_ROOT/terraform"

        # Check if Terraform is initialized
        if [ -d ".terraform" ]; then
            VPC_ID=$(terraform output -raw eb_vpc_id 2>/dev/null || echo "")
            PRIVATE_SUBNETS=$(terraform output -raw eb_private_subnets 2>/dev/null || echo "")
            PUBLIC_SUBNETS=$(terraform output -raw eb_public_subnets 2>/dev/null || echo "")
            INSTANCE_SG=$(terraform output -raw eb_instance_security_group 2>/dev/null || echo "")
            INSTANCE_PROFILE=$(terraform output -raw eb_instance_profile 2>/dev/null || echo "")
            SERVICE_ROLE=$(terraform output -raw eb_service_role 2>/dev/null || echo "")
        fi
        cd "$PROJECT_ROOT"
    fi

    # Validate we have required values
    if [ -z "$VPC_ID" ] || [ -z "$PRIVATE_SUBNETS" ] || [ -z "$PUBLIC_SUBNETS" ]; then
        echo "Error: Could not get infrastructure details from Terraform"
        echo "Run ./scripts/deploy-infrastructure.sh first, or set these environment variables:"
        echo "  EB_VPC_ID, EB_PRIVATE_SUBNETS, EB_PUBLIC_SUBNETS, EB_INSTANCE_SG, EB_INSTANCE_PROFILE, EB_SERVICE_ROLE"
        exit 1
    fi

    # Use env vars as overrides if set
    VPC_ID="${EB_VPC_ID:-$VPC_ID}"
    PRIVATE_SUBNETS="${EB_PRIVATE_SUBNETS:-$PRIVATE_SUBNETS}"
    PUBLIC_SUBNETS="${EB_PUBLIC_SUBNETS:-$PUBLIC_SUBNETS}"
    INSTANCE_SG="${EB_INSTANCE_SG:-$INSTANCE_SG}"
    INSTANCE_PROFILE="${EB_INSTANCE_PROFILE:-$INSTANCE_PROFILE}"
    SERVICE_ROLE="${EB_SERVICE_ROLE:-$SERVICE_ROLE}"

    echo "Creating EB environment with:"
    echo "  VPC: $VPC_ID"
    echo "  Private Subnets: $PRIVATE_SUBNETS"
    echo "  Public Subnets: $PUBLIC_SUBNETS"

    aws elasticbeanstalk create-environment \
        --application-name "$APP_NAME" \
        --environment-name "$ENV_NAME" \
        --solution-stack-name "64bit Amazon Linux 2023 v4.4.4 running Docker" \
        --version-label "$VERSION_LABEL" \
        --option-settings \
            "Namespace=aws:ec2:vpc,OptionName=VPCId,Value=$VPC_ID" \
            "Namespace=aws:ec2:vpc,OptionName=Subnets,Value=$PRIVATE_SUBNETS" \
            "Namespace=aws:ec2:vpc,OptionName=ELBSubnets,Value=$PUBLIC_SUBNETS" \
            "Namespace=aws:ec2:vpc,OptionName=ELBScheme,Value=public" \
            "Namespace=aws:autoscaling:launchconfiguration,OptionName=IamInstanceProfile,Value=$INSTANCE_PROFILE" \
            "Namespace=aws:autoscaling:launchconfiguration,OptionName=SecurityGroups,Value=$INSTANCE_SG" \
            "Namespace=aws:elasticbeanstalk:environment,OptionName=ServiceRole,Value=$SERVICE_ROLE" \
            "Namespace=aws:elasticbeanstalk:environment,OptionName=LoadBalancerType,Value=application" \
            "Namespace=aws:autoscaling:launchconfiguration,OptionName=InstanceType,Value=t3.small" \
            "Namespace=aws:elasticbeanstalk:application:environment,OptionName=NODE_ENV,Value=production" \
            "Namespace=aws:elasticbeanstalk:application:environment,OptionName=PORT,Value=80" \
            "Namespace=aws:elasticbeanstalk:environment:process:default,OptionName=HealthCheckPath,Value=/health" \
            "Namespace=aws:elasticbeanstalk:environment:process:default,OptionName=StickinessEnabled,Value=true" \
        --region "$AWS_REGION" \
        --no-cli-pager
    echo "Environment creation initiated (this takes 5-10 minutes for new environments)"
else
    echo "Updating existing environment..."
    aws elasticbeanstalk update-environment \
        --application-name "$APP_NAME" \
        --environment-name "$ENV_NAME" \
        --version-label "$VERSION_LABEL" \
        --region "$AWS_REGION" \
        --no-cli-pager
    echo "Deployment initiated"
fi

echo ""
echo "Step 7: Waiting for deployment to complete..."
echo "-----------------------------------"
if [ "$ENV_EXISTS" = "0" ]; then
    echo "Creating new environment - this takes 5-10 minutes..."
else
    echo "Updating environment - this takes 3-5 minutes..."
fi

# Wait for environment to be ready
aws elasticbeanstalk wait environment-updated \
    --application-name "$APP_NAME" \
    --environment-name "$ENV_NAME" \
    --region "$AWS_REGION"

# Check final status
STATUS=$(aws elasticbeanstalk describe-environments \
    --application-name "$APP_NAME" \
    --environment-names "$ENV_NAME" \
    --query "Environments[0].Status" \
    --output text \
    --region "$AWS_REGION")

HEALTH=$(aws elasticbeanstalk describe-environments \
    --application-name "$APP_NAME" \
    --environment-names "$ENV_NAME" \
    --query "Environments[0].Health" \
    --output text \
    --region "$AWS_REGION")

echo ""
echo "=========================================="
echo "Deployment Complete!"
echo "=========================================="
echo ""
echo "Environment: $ENV_NAME"
echo "Version: $VERSION_LABEL"
echo "Status: $STATUS"
echo "Health: $HEALTH"
echo ""

# Clean up local ZIP
rm -f "$ZIP_FILE"

if [ "$HEALTH" = "Green" ]; then
    echo "Deployment successful!"
    exit 0
else
    echo "Warning: Environment health is $HEALTH"
    echo "Check logs with: aws elasticbeanstalk request-environment-info --environment-name $ENV_NAME --info-type tail"
    exit 1
fi
