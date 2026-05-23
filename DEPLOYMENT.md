# Ship - AWS Deployment Guide

**Optional AWS/Terraform deployment path for Express API + React frontend.**

The current public/demo deployment path is Render (`render.yaml`). Keep this guide for future government-style AWS infrastructure work; do not treat it as the only active deployment path.

## Prerequisites

Install required tools:

```bash
# Terraform
brew install terraform

# AWS CLI
brew install awscli

# pnpm (package manager)
npm install -g pnpm

# PostgreSQL client (for database initialization)
brew install postgresql@16
```

Configure AWS credentials:

```bash
aws configure
# Enter your AWS Access Key ID, Secret Access Key, and default region
```

## Architecture Overview

```
Frontend (React) → CloudFront → S3
API (Express)    → ALB → Elastic Beanstalk (Docker) → Aurora PostgreSQL
                                                    ↓
                                            SSM Parameter Store
```

## Deployment Steps

### 1. Deploy Infrastructure (One-time)

Infrastructure includes VPC, Aurora database, S3, CloudFront, and Elastic Beanstalk application.

```bash
# Copy and configure Terraform variables
cd terraform
cp terraform.tfvars.example terraform.tfvars

# Edit terraform.tfvars with your values:
# - aws_region: Your AWS region (e.g., "us-east-1")
# - project_name: "ship" (or your project name)
# - environment: "dev", "staging", or "prod"
# - route53_zone_id: (optional) Your Route53 zone ID for custom domains
# - api_domain_name: (optional) Custom API domain (e.g., "api.example.gov")
# - app_domain_name: (optional) Custom frontend domain (e.g., "app.example.gov")

# Deploy infrastructure
cd ..
./scripts/deploy-infrastructure.sh
```

**Important:** Save the Terraform outputs - you'll need them for the next steps.

**Cost:** ~$80/month for dev environment (t3.small + Aurora Serverless v2 0.5 ACU)

### 2. Deploy API (Initial and Subsequent)

Deploy the Express API to Elastic Beanstalk:

```bash
# Set environment variables (required)
export EB_APP_NAME="ship-api"           # From terraform output eb_application_name
export EB_ENV_NAME="ship-api-dev"       # From terraform output eb_environment_name
export AWS_REGION="us-east-1"           # Your AWS region

# Deploy
./scripts/deploy-api.sh
```

For environment-aware API deploys (dev, shadow, prod), use `./scripts/deploy.sh <dev|shadow|prod>` instead. Shadow UAT uses `./scripts/deploy.sh shadow` plus `./scripts/deploy-web.sh shadow` for the frontend.

The script automatically:
1. Builds the shared TypeScript package
2. Builds the API package, including the migration runner and database files
3. Creates a deployment ZIP with proper structure
4. Uploads to S3 and creates EB application version
5. Deploys to EB environment and waits for completion

**First deployment:** 5-10 minutes
**Subsequent deployments:** 3-5 minutes

### 3. Initialize Database (One-time)

Run the migration runner and optionally seed with test data:

```bash
./scripts/init-database.sh
```

This script:
- Fetches the DATABASE_URL from SSM Parameter Store
- Runs `api/src/db/migrate.ts`, which applies the bootstrap schema on fresh databases and then runs numbered migrations
- Optionally seeds test data

### 4. Deploy Frontend (Frequent)

Deploy the React frontend:

```bash
./scripts/deploy-frontend.sh dev   # or prod
```

This script:
- Builds the React app (`pnpm build:web`)
- Syncs to S3 bucket
- Invalidates CloudFront cache

**Build takes:** 1-2 minutes
**CloudFront invalidation takes:** 1-2 minutes

## Configuration

### Environment Variables

Environment variables are managed via:
- SSM Parameter Store (for secrets)
- `.ebextensions/01-env.config` (for non-secrets)

To update environment variables:

1. **For secrets:** Update SSM Parameter Store
   ```bash
   aws ssm put-parameter \
     --name "/ship/dev/DATABASE_URL" \
     --type "SecureString" \
     --value "postgresql://..." \
     --overwrite
   ```

2. **For non-secrets:** Update `.ebextensions/01-env.config` and redeploy

### Custom Domains

To use custom domains (e.g., `api.example.gov` and `app.example.gov`):

1. Ensure DNS delegation is configured:
   ```bash
   dig +short api.example.gov NS
   dig +short app.example.gov NS
   ```

2. Update `terraform.tfvars`:
   ```hcl
   route53_zone_id  = "Z1234567890ABC"
   api_domain_name  = "api.example.gov"
   app_domain_name  = "app.example.gov"
   ```

3. Re-run Terraform:
   ```bash
   ./scripts/deploy-infrastructure.sh
   ```

4. Wait for ACM certificate validation (5-30 minutes)

## Monitoring and Logs

### View API Logs

Using AWS CLI:

```bash
# Request logs from EB
aws elasticbeanstalk request-environment-info \
  --environment-name ship-api-dev \
  --info-type tail

# Wait a moment, then retrieve them
aws elasticbeanstalk retrieve-environment-info \
  --environment-name ship-api-dev \
  --info-type tail
```

Or use CloudWatch Logs directly:
- Application: `/aws/elasticbeanstalk/ship-api-dev/var/log/eb-docker/containers/eb-current-app/stdouterr.log`
- Docker: `/aws/elasticbeanstalk/ship-api-dev/var/log/eb-docker/containers/eb-current-app/`

### View API Status

```bash
# Environment status
aws elasticbeanstalk describe-environments \
  --environment-names ship-api-dev \
  --query "Environments[0].[Status,Health,HealthStatus]" \
  --output table

# Detailed health
aws elasticbeanstalk describe-environment-health \
  --environment-name ship-api-dev \
  --attribute-names All
```

### View Frontend Access Logs

CloudFront access logs are disabled by default to save costs. To enable:

1. Create S3 bucket for logs
2. Update `terraform/s3-cloudfront.tf` to add logging configuration
3. Apply Terraform changes

## Troubleshooting

### API Not Starting

1. Check EB logs: `eb logs`
2. Common issues:
   - Database connection failed (check SSM parameters)
   - Port mismatch (ensure PORT=8080 in env)
   - Build failed (check Dockerfile)

### WebSocket Not Working

1. Check ALB target group health
2. Verify sticky sessions are enabled (should be in `.ebextensions/01-env.config`)
3. Check nginx configuration in `.platform/nginx/conf.d/websocket.conf`

### Database Connection Timeout

1. Check security group rules:
   ```bash
   cd terraform
   terraform state show aws_security_group_rule.aurora_ingress_from_eb
   ```

2. Verify EB instances are in private subnets
3. Check NAT Gateway is running (required for Aurora DNS resolution)

### Frontend Not Loading

1. Check CloudFront distribution status:
   ```bash
   aws cloudfront get-distribution --id $(cd terraform && terraform output -raw cloudfront_distribution_id)
   ```

2. Check S3 bucket contents:
   ```bash
   aws s3 ls s3://$(cd terraform && terraform output -raw s3_bucket_name)/
   ```

3. Wait for CloudFront invalidation to complete (1-2 minutes)

## Cost Optimization

### Development Environment

- Use Aurora Serverless v2 with `min_capacity = 0.5` (pauses when idle)
- Use t3.small instances for EB (~$15/month)
- Enable CloudFront regional restrictions if only serving US

### Production Environment

- Increase Aurora capacity for performance
- Use t3.medium or larger for EB
- Enable multi-AZ for EB (2+ instances)
- Enable Aurora read replicas if needed

## Security Compliance

This deployment follows government compliance patterns:

- **Encryption at rest:** Aurora (storage), S3 (AES256)
- **Encryption in transit:** TLS 1.2+ for all connections
- **Audit logging:** CloudTrail (API calls), VPC Flow Logs (network), CloudWatch Logs (application)
- **Secret management:** SSM Parameter Store (SecureString)
- **Network isolation:** Private subnets for compute/database, no internet-facing databases
- **Container images:** ECR Public only (no Docker Hub)

## Disaster Recovery

### Backup Strategy

- **Aurora:** Automated daily backups (7-day retention for prod)
- **S3:** Versioning enabled on frontend bucket

### Restore Procedure

1. **Database restore:**
   ```bash
   aws rds restore-db-cluster-to-point-in-time \
     --source-db-cluster-identifier ship-aurora \
     --target-db-cluster-identifier ship-aurora-restored \
     --restore-to-time 2024-01-01T00:00:00Z
   ```

2. **Frontend restore:**
   ```bash
   aws s3api list-object-versions --bucket ship-frontend-dev --prefix index.html
   aws s3api get-object --bucket ship-frontend-dev --key index.html --version-id <VERSION_ID> index.html
   ```

## Maintenance

### Update Node.js Version

1. Update Dockerfile base image:
   ```dockerfile
   FROM public.ecr.aws/docker/library/node:22-slim
   ```

2. Redeploy API: `./scripts/deploy-api.sh`

### Update Database Schema

1. Add a numbered migration under `api/src/db/migrations/`.
2. Keep `api/src/db/schema.sql` aligned only for fresh database bootstrap when needed.
3. Run the migration runner:
   ```bash
   DATABASE_URL=$(aws ssm get-parameter --name "/ship/dev/DATABASE_URL" --with-decryption --query "Parameter.Value" --output text)
   pnpm --filter @ship/api db:migrate
   ```

Do not manually apply `api/src/db/schema.sql` to an existing database. Existing databases move forward through numbered migrations.

### Terraform State Management

For production, use S3 backend for Terraform state:

1. Create S3 bucket: `ship-terraform-state`
2. Uncomment backend configuration in `terraform/versions.tf`
3. Migrate state:
   ```bash
   cd terraform
   terraform init -migrate-state
   ```

## Cleanup

To destroy all infrastructure (WARNING: irreversible):

```bash
# Delete EB environment first
aws elasticbeanstalk terminate-environment \
  --environment-name ship-api-dev

# Wait for termination (5-10 minutes)
aws elasticbeanstalk wait environment-terminated \
  --environment-name ship-api-dev

# Then destroy Terraform resources
cd terraform
terraform destroy
```

This will delete:
- All EC2 instances, load balancers, and networking
- Aurora database (final snapshot created if prod)
- S3 bucket (must be empty first)
- CloudFront distribution
- All SSM parameters

**Total time:** 15-20 minutes
