# Ship - Optional AWS Infrastructure Summary

**Optional government-style AWS infrastructure path for production deployment**

## What Was Created

This infrastructure setup provides a future AWS path for Ship (Express API + React frontend) following government compliance patterns. The current public/demo deployment path is Render via `render.yaml`.

### Files Created

```
terraform/
├── versions.tf              - Provider configuration
├── variables.tf             - Input variables with defaults
├── vpc.tf                   - VPC, subnets, NAT, Flow Logs
├── security-groups.tf       - Network security (ALB, EB, Aurora)
├── database.tf              - Aurora Serverless v2 PostgreSQL
├── ssm.tf                   - SSM Parameter Store for secrets
├── elastic-beanstalk.tf     - EB application and IAM roles
├── s3-cloudfront.tf         - Frontend hosting
├── outputs.tf               - Output values for deployment
├── terraform.tfvars.example - Configuration template
└── README.md                - Detailed Terraform documentation

api/
├── Dockerfile               - Multi-stage Docker build (ECR Public)
├── .dockerignore            - Exclude unnecessary files from image
├── .ebignore                - Exclude unnecessary files from EB upload
├── .platform/
│   └── nginx/
│       └── conf.d/
│           └── websocket.conf - WebSocket proxy configuration
└── .ebextensions/
    ├── 01-env.config        - Environment variables from SSM
    └── 02-cloudwatch.config - Logging and health monitoring

scripts/
├── deploy-infrastructure.sh - Deploy Terraform resources
├── deploy-api.sh            - Deploy API to Elastic Beanstalk
├── deploy-frontend.sh       - Deploy frontend to S3 + CloudFront
└── init-database.sh         - Initialize database schema

docs/
├── INFRASTRUCTURE.md        - Architecture overview
├── DEPLOYMENT.md            - Complete deployment guide
├── DEPLOYMENT_CHECKLIST.md  - Quick reference checklist
└── INFRASTRUCTURE_SUMMARY.md - This file
```

## Architecture Components

### Network Layer
- **VPC:** 10.0.0.0/16 with DNS enabled
- **Public Subnets:** 2 subnets across AZs for ALB
- **Private Subnets:** 2 subnets across AZs for EB and Aurora
- **NAT Gateway:** For private subnet internet access (Docker pulls)
- **Internet Gateway:** For public subnet access
- **VPC Flow Logs:** Network traffic audit logging

### Compute Layer
- **Elastic Beanstalk:** Docker platform for Express API
  - Platform: Docker on Amazon Linux 2023
  - Instance: t3.small (configurable)
  - Auto-scaling: 1-4 instances (configurable)
  - Health monitoring: Enhanced with CloudWatch
- **Application Load Balancer:** Sticky sessions for WebSocket
- **nginx:** WebSocket proxy with long timeouts

### Database Layer
- **Aurora Serverless v2:** PostgreSQL 16
  - Scaling: 0.5-4 ACUs (configurable)
  - Encryption: At rest with AES256
  - Backups: Automated daily (7-day retention for prod)
  - Monitoring: CloudWatch Logs for query analysis

### Frontend Layer
- **S3 Bucket:** Static file hosting
  - Versioning: Enabled for rollback
  - Encryption: AES256
  - Access: CloudFront only (no public access)
- **CloudFront:** Global CDN
  - HTTPS: TLS 1.2+ only
  - Caching: Optimized for SPA routing
  - Custom domain: Optional ACM certificate

### Security Layer
- **IAM Roles:**
  - EB instance role: SSM access, CloudWatch logs
  - EB service role: Enhanced health reporting
- **Security Groups:**
  - ALB: Public HTTP/HTTPS (80/443)
  - EB instances: ALB only (80), outbound for updates
  - Aurora: EB instances only (5432), no outbound
- **SSM Parameter Store:**
  - DATABASE_URL (SecureString)
  - CORS_ORIGIN (String)
  - Additional secrets as needed

## Key Features

### Government Compliance
- ECR Public images only (Docker Hub blocked)
- SSL strict mode disabled for VPN environments
- SSM Parameter Store (not Secrets Manager)
- No Alpine images (use `-slim` variants)
- CloudTrail integration ready
- VPC Flow Logs enabled
- Encryption at rest and in transit

### WebSocket Support
- ALB sticky sessions (86400s)
- nginx WebSocket proxy with 3600s timeout
- TipTap Yjs collaboration fully supported

### Cost Optimization
- Aurora Serverless v2 (scales to 0.5 ACU)
- Single NAT Gateway (not per AZ)
- CloudFront PriceClass_100 (US/Canada/Europe)
- S3 Intelligent-Tiering ready

### High Availability
- Multi-AZ deployment
- Aurora automatic failover
- ALB health checks with auto-scaling
- S3 versioning for rollback

## Configuration

### Required Variables (terraform.tfvars)

```hcl
aws_region   = "us-east-1"
project_name = "ship"
environment  = "dev"
```

### Optional Variables

```hcl
# Custom domains
route53_zone_id  = "Z1234567890ABC"
api_domain_name  = "api.example.gov"
app_domain_name  = "app.example.gov"

# Database scaling
aurora_min_capacity = 0.5
aurora_max_capacity = 4

# VPC
vpc_cidr           = "10.0.0.0/16"
enable_nat_gateway = true
```

## Deployment Process

### 1. Infrastructure (One-time: 10-15 min)
```bash
./scripts/deploy-infrastructure.sh
```
Creates VPC, Aurora, S3, CloudFront, EB application, security groups, IAM roles, SSM parameters.

### 2. EB Environment (One-time: 10-15 min)
```bash
cd api
eb init
eb create ship-api-dev --instance-type t3.small # ... (full command in DEPLOYMENT.md)
```
Creates ALB, EC2 instances, deploys Docker container.

### 3. Database (One-time: 2-3 min)
```bash
./scripts/init-database.sh
```
Runs the migration runner, optionally seeds test data.

### 4. API (Frequent: 3-5 min)
```bash
./scripts/deploy-api.sh
```
Builds Docker image, uploads to EB, rolling deployment.

### 5. Frontend (Frequent: 2-3 min)
```bash
./scripts/deploy-frontend.sh
```
Builds React app, syncs to S3, invalidates CloudFront.

## Cost Breakdown

### Development Environment (~$80/month)
| Resource | Cost |
|----------|------|
| Aurora Serverless v2 (0.5 ACU min) | $43 |
| EB t3.small (1 instance) | $15 |
| Application Load Balancer | $20 |
| S3 + CloudFront | $2 |
| **Total** | **~$80** |

### Production Environment (~$200/month)
| Resource | Cost |
|----------|------|
| Aurora Serverless v2 (1 ACU min) | $86 |
| EB t3.medium (2-4 instances) | $60-120 |
| Application Load Balancer | $20 |
| NAT Gateway | $33 |
| S3 + CloudFront | $5 |
| **Total** | **~$200-260** |

Note: Costs vary by region and actual usage.

## Monitoring

### CloudWatch Log Groups
- `/aws/elasticbeanstalk/ship-api/application` - API logs
- `/aws/elasticbeanstalk/ship-api/nginx` - nginx logs
- `/aws/rds/cluster/ship-aurora/postgresql` - Database logs
- `/aws/vpc/ship` - VPC Flow Logs

### Health Checks
- EB health: `eb health`
- API health: `curl https://api.example.gov/health`
- Aurora health: RDS console

### Metrics
- EB: CPU, memory, request count, response time
- Aurora: CPU, connections, IOPS, storage
- CloudFront: Cache hit rate, error rate, bandwidth

## Security Best Practices

### Secrets Management
- Never commit `terraform.tfvars` (in `.gitignore`)
- Never commit `.env` files (in `.gitignore`)
- Store all secrets in SSM Parameter Store
- Use IAM roles, never access keys in code

### Network Security
- Database in private subnets only
- No public IP addresses on EB instances
- Security groups follow least privilege
- Aurora has no outbound access

### Compliance
- Enable CloudTrail for API audit logging
- VPC Flow Logs enabled by default
- Encryption at rest (Aurora, S3)
- TLS 1.2+ for all connections
- Regular security updates via EB platform

## Disaster Recovery

### Backup
- Aurora: Automated daily backups (7-day retention)
- S3: Versioning enabled for rollback
- Terraform state: Use S3 backend for production

### Restore
1. Restore Aurora from snapshot or point-in-time
2. Update SSM parameters with new endpoint
3. Redeploy API: `./scripts/deploy-api.sh`
4. Restore S3 from version history if needed

### RTO/RPO
- **RTO (Recovery Time Objective):** 15-30 minutes
- **RPO (Recovery Point Objective):** 5 minutes (Aurora PITR)

## Maintenance

### Update Node.js Version
1. Update `api/Dockerfile` base image
2. Deploy: `./scripts/deploy-api.sh`

### Update Database Schema
1. Add a numbered migration under `api/src/db/migrations/`
2. Keep `api/src/db/schema.sql` aligned only when fresh bootstrap needs it
3. Run: `./scripts/init-database.sh` or `pnpm --filter @ship/api db:migrate`

### Update Terraform Providers
1. Run: `cd terraform && terraform init -upgrade`
2. Review: `terraform plan`
3. Apply: `terraform apply`

### Scale Resources
Update `terraform.tfvars`:
```hcl
aurora_min_capacity = 1    # Increase for production
aurora_max_capacity = 8    # Increase for production
```
Apply: `cd terraform && terraform apply`

## Troubleshooting

### API Not Starting
- Check logs: `cd api && eb logs`
- Verify SSM parameters: `aws ssm get-parameter --name "/ship/dev/DATABASE_URL"`
- Check security groups: EB → Aurora connectivity

### WebSocket Not Working
- Verify sticky sessions enabled in `.ebextensions/01-env.config`
- Check nginx config in `.platform/nginx/conf.d/websocket.conf`
- Test with: `wscat -c wss://api.example.gov/collaboration/wiki:123`

### Database Connection Timeout
- Check NAT Gateway is running
- Verify Aurora security group allows EB ingress
- Check Aurora cluster status in RDS console

### Frontend Not Loading
- Wait for CloudFront invalidation (1-2 min)
- Check S3 bucket contents: `aws s3 ls s3://ship-frontend-dev/`
- Check CloudFront distribution status

## Next Steps

### Immediate
1. Configure `terraform.tfvars` with your AWS account details
2. Deploy infrastructure: `./scripts/deploy-infrastructure.sh`
3. Initialize EB environment (see DEPLOYMENT.md)
4. Deploy application: API then frontend

### Short Term
1. Set up custom domains (if applicable)
2. Configure monitoring alerts in CloudWatch
3. Set up CI/CD pipeline (GitHub Actions + EB CLI)
4. Configure backup retention for production

### Long Term
1. Implement multi-environment strategy (dev/staging/prod)
2. Set up WAF for DDoS protection
3. Implement Aurora read replicas for scaling
4. Configure disaster recovery procedures

## Support

For detailed instructions, see:
- **DEPLOYMENT.md** - Complete step-by-step deployment guide
- **DEPLOYMENT_CHECKLIST.md** - Quick reference for regular deployments
- **terraform/README.md** - Terraform-specific documentation
- **INFRASTRUCTURE.md** - Architecture overview and decisions

## Success Criteria

Infrastructure is ready when:
- [ ] Terraform apply completes successfully
- [ ] EB environment shows "Green" health status
- [ ] API health check returns `{"status":"ok"}`
- [ ] Frontend loads in browser
- [ ] WebSocket collaboration works
- [ ] Database connection succeeds
- [ ] All CloudWatch log groups receiving logs

Expected setup time: 30-45 minutes for initial deployment
