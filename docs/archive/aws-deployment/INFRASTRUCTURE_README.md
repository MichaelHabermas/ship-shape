# Ship - Optional AWS Infrastructure (Archived)

> Archived duplicate. Keep for historical AWS/Terraform context. Current entry point: `DEPLOYMENT.md`; canonical deep reference: `terraform/README.md`.

**Optional government-style infrastructure path for production deployment**

The current public/demo deployment path is Render via `render.yaml`. Keep this AWS path for future government-style infrastructure work.

## Quick Start

```bash
# 1. Install prerequisites
brew install terraform awscli postgresql@16
pip install awsebcli

# 2. Configure AWS credentials
aws configure

# 3. Deploy infrastructure (one-time, 10-15 min)
cd terraform
cp terraform.tfvars.example terraform.tfvars
# Edit terraform.tfvars with your values
cd ..
./scripts/deploy-infrastructure.sh

# 4. Initialize Elastic Beanstalk (one-time, 10-15 min)
cd api
eb init
# Follow prompts, then create environment (see DEPLOYMENT.md for full command)

# 5. Initialize database (one-time, 2-3 min)
cd ..
./scripts/init-database.sh

# 6. Deploy application (frequent, 5-8 min)
./scripts/deploy-api.sh
./scripts/deploy-frontend.sh dev   # or prod
```

## Documentation

| Document | Purpose |
|----------|---------|
| **INFRASTRUCTURE.md** | Architecture overview and design decisions |
| **DEPLOYMENT.md** | Complete step-by-step deployment guide |
| **DEPLOYMENT_CHECKLIST.md** | Quick reference for regular deployments |
| **INFRASTRUCTURE_SUMMARY.md** | Comprehensive summary of all components |
| **terraform/README.md** | Terraform-specific documentation |

## Infrastructure Files Created

### Terraform Configuration (Infrastructure as Code)
```
terraform/
├── versions.tf              - Terraform and provider versions
├── variables.tf             - Configuration variables
├── vpc.tf                   - VPC, subnets, NAT, Internet Gateway
├── security-groups.tf       - Network security rules
├── database.tf              - Aurora Serverless v2 PostgreSQL
├── ssm.tf                   - SSM Parameter Store for secrets
├── elastic-beanstalk.tf     - EB application and IAM roles
├── s3-cloudfront.tf         - Frontend hosting (S3 + CloudFront)
├── outputs.tf               - Output values for deployment
├── terraform.tfvars.example - Configuration template
└── README.md                - Terraform documentation
```

### API Configuration (Elastic Beanstalk)
```
api/
├── Dockerfile               - Multi-stage Docker build (ECR Public)
├── .dockerignore            - Exclude files from Docker build
├── .ebignore                - Exclude files from EB upload
├── .platform/
│   └── nginx/
│       └── conf.d/
│           └── websocket.conf - WebSocket proxy configuration
└── .ebextensions/
    ├── 01-env.config        - Environment variables (SSM integration)
    └── 02-cloudwatch.config - Logging and health monitoring
```

### Deployment Scripts
```
scripts/
├── deploy-infrastructure.sh - Deploy Terraform resources
├── deploy-api.sh            - Deploy API to Elastic Beanstalk
├── deploy-frontend.sh       - Deploy frontend to S3 + CloudFront
└── init-database.sh         - Initialize database schema
```

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│ Route53 + ACM Certificate                                           │
│  ├─ api.example.gov → ALB → Elastic Beanstalk (Express + WebSocket)│
│  └─ app.example.gov → CloudFront → S3 (React static site)          │
└─────────────────────────────────────────────────────────────────────┘
         │                                    │
         │                                    │
┌────────▼────────────────────────────────────▼───────────────────────┐
│ VPC (10.0.0.0/16)                                                   │
│  ┌──────────────────┐         ┌──────────────────────────────────┐ │
│  │ Public Subnets   │         │ Private Subnets                  │ │
│  │  ┌────────────┐  │         │  ┌────────────────────────────┐  │ │
│  │  │    ALB     │◄─┼─────────┼──│ Elastic Beanstalk          │  │ │
│  │  └────────────┘  │         │  │ (Docker: Express + WS)     │  │ │
│  └──────────────────┘         │  └────────────────────────────┘  │ │
│                               │  ┌────────────────────────────┐  │ │
│                               │  │ Aurora Serverless v2       │  │ │
│                               │  │ (PostgreSQL 16)            │  │ │
│                               │  └────────────────────────────┘  │ │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                          ┌─────────▼────────┐
                          │ SSM Parameter    │
                          │ Store (Secrets)  │
                          └──────────────────┘
```

## Key Features

### Government Compliance
- **Container images:** ECR Public only (Docker Hub blocked)
- **SSL handling:** Strict SSL disabled for VPN environments
- **Secrets:** SSM Parameter Store (not Secrets Manager)
- **No Alpine:** Use `-slim` variants for base images
- **Audit logging:** VPC Flow Logs, CloudWatch Logs, CloudTrail-ready
- **Encryption:** At rest (Aurora, S3) and in transit (TLS 1.2+)

### WebSocket Support
- ALB with sticky sessions (86400s)
- nginx WebSocket proxy with long timeouts (3600s)
- Full support for TipTap Yjs collaboration

### Cost Optimization
- Aurora Serverless v2 (scales to 0.5 ACU, ~$43/month)
- Single NAT Gateway (~$33/month)
- t3.small EB instances (~$15/month)
- CloudFront PriceClass_100 (US/Canada/Europe only)
- **Total dev cost:** ~$80/month

### High Availability
- Multi-AZ deployment (2 AZs)
- Aurora automatic failover
- ALB health checks with auto-scaling
- S3 versioning for rollback

## Cost Estimates

| Environment | Aurora | EB | ALB | NAT | S3+CF | Total |
|-------------|--------|----|----|-----|-------|-------|
| **Dev** | $43 | $15 | $20 | - | $2 | **~$80/mo** |
| **Prod** | $86 | $60-120 | $20 | $33 | $5 | **~$200-260/mo** |

Note: Dev environment can disable NAT Gateway if using VPC endpoints for ECR/S3/SSM.

## Deployment Workflow

### Initial Setup (One-time)
1. **Infrastructure** (10-15 min): `./scripts/deploy-infrastructure.sh`
   - Creates VPC, Aurora, S3, CloudFront, security groups, IAM roles
2. **EB Environment** (10-15 min): `eb init` then `eb create`
   - Creates ALB, EC2 instances, deploys Docker container
3. **Database** (2-3 min): `./scripts/init-database.sh`
   - Runs migrations, optionally seeds data

**Total setup time:** 30-45 minutes

### Regular Deployments (Frequent)
- **API changes** (3-5 min): `./scripts/deploy-api.sh`
- **Frontend changes** (2-3 min): `./scripts/deploy-frontend.sh`
- **Both** (5-8 min): Run both scripts

## Configuration

### Required Variables (terraform.tfvars)
```hcl
aws_region   = "us-east-1"
project_name = "ship"
environment  = "dev"
```

### Optional Variables
```hcl
# Custom domains (requires Route53 zone)
route53_zone_id  = "Z1234567890ABC"
api_domain_name  = "api.example.gov"
app_domain_name  = "app.example.gov"

# Database scaling
aurora_min_capacity = 0.5  # ACUs (0.5-128)
aurora_max_capacity = 4    # ACUs (0.5-128)

# Network
vpc_cidr           = "10.0.0.0/16"
enable_nat_gateway = true  # Required for EB Docker pulls
```

## Monitoring

### CloudWatch Log Groups
- `/aws/elasticbeanstalk/ship-api/application` - API logs
- `/aws/elasticbeanstalk/ship-api/nginx` - nginx access/error logs
- `/aws/rds/cluster/ship-aurora/postgresql` - Database query logs
- `/aws/vpc/ship` - VPC Flow Logs

### Health Checks
```bash
# EB environment health
cd api && eb health

# API health endpoint
curl https://api.example.gov/health
# Should return: {"status":"ok"}

# Aurora status
aws rds describe-db-clusters --db-cluster-identifier ship-aurora
```

### Key Metrics to Monitor
- EB: CPU utilization, request count, response time, error rate
- Aurora: CPU, connections, read/write IOPS, storage
- CloudFront: Cache hit ratio, error rate, bandwidth

## Security

### Secrets Management
- Never commit `terraform.tfvars` or `.env` files
- Store all secrets in SSM Parameter Store
- Use IAM roles (no hardcoded access keys)
- Rotate database passwords via Terraform

### Network Security
- Database in private subnets only
- No public IPs on EB instances
- Security groups follow least privilege
- Aurora has no outbound access (no egress rules)

### Compliance Features
- Encryption at rest: Aurora (storage), S3 (AES256)
- Encryption in transit: TLS 1.2+ for all connections
- Audit logging: VPC Flow Logs, CloudWatch Logs
- Secret management: SSM Parameter Store (SecureString with KMS)

## Troubleshooting

### API Not Starting
1. Check logs: `cd api && eb logs`
2. Verify SSM parameters: `aws ssm get-parameter --name "/ship/dev/DATABASE_URL" --with-decryption`
3. Check security groups allow EB → Aurora traffic

### WebSocket Not Working
1. Verify sticky sessions in `.ebextensions/01-env.config`
2. Check nginx config in `.platform/nginx/conf.d/websocket.conf`
3. Test WebSocket: `wscat -c wss://api.example.gov/collaboration/wiki:123`

### Database Connection Timeout
1. Check NAT Gateway is running (required for DNS resolution)
2. Verify Aurora security group allows EB ingress
3. Check Aurora cluster status: `aws rds describe-db-clusters`

### Frontend Not Loading
1. Wait for CloudFront invalidation (1-2 minutes)
2. Check S3 contents: `aws s3 ls s3://$(cd terraform && terraform output -raw s3_bucket_name)/`
3. Check CloudFront distribution status

## Disaster Recovery

### Backup Strategy
- **Aurora:** Automated daily backups, 7-day retention (prod)
- **S3:** Versioning enabled for rollback
- **Terraform state:** Use S3 backend for production

### Restore Procedure
```bash
# 1. Restore Aurora from snapshot
aws rds restore-db-cluster-from-snapshot \
  --db-cluster-identifier ship-aurora-restored \
  --snapshot-identifier ship-aurora-snapshot

# 2. Update SSM parameters with new endpoint
aws ssm put-parameter \
  --name "/ship/dev/DATABASE_URL" \
  --type "SecureString" \
  --value "postgresql://..." \
  --overwrite

# 3. Redeploy API
./scripts/deploy-api.sh
```

**RTO (Recovery Time Objective):** 15-30 minutes
**RPO (Recovery Point Objective):** 5 minutes (Aurora PITR)

## Maintenance

### Update Node.js Version
1. Update `api/Dockerfile` base image: `FROM public.ecr.aws/docker/library/node:22-slim`
2. Redeploy: `./scripts/deploy-api.sh`

### Update Database Schema
1. Add a numbered migration under `api/src/db/migrations/`
2. Keep `api/src/db/schema.sql` aligned only when fresh bootstrap needs it
3. Apply with `./scripts/init-database.sh` or `pnpm --filter @ship/api db:migrate`

### Update Terraform Providers
```bash
cd terraform
terraform init -upgrade
terraform plan
terraform apply
```

### Scale Resources
Update `terraform.tfvars`:
```hcl
aurora_min_capacity = 1    # Increase for production
aurora_max_capacity = 8    # Increase for production
```
Apply: `cd terraform && terraform apply`

## Cleanup

To destroy all infrastructure:

```bash
# 1. Delete EB environment first
cd api
eb terminate ship-api-dev

# 2. Destroy Terraform resources
cd ../terraform
terraform destroy
```

**Warning:** This is irreversible. Ensure you have backups.

## Next Steps

1. **Configure:** Copy `terraform/terraform.tfvars.example` to `terraform/terraform.tfvars`
2. **Deploy:** Follow DEPLOYMENT.md for step-by-step instructions
3. **Monitor:** Set up CloudWatch alarms for key metrics
4. **Secure:** Review security group rules and IAM policies
5. **Scale:** Adjust Aurora capacity and EB instance types as needed

## Support

For questions or issues:
1. Check **DEPLOYMENT.md** for detailed deployment steps
2. Check **DEPLOYMENT_CHECKLIST.md** for quick reference
3. Check **INFRASTRUCTURE_SUMMARY.md** for component details
4. Review CloudWatch logs for error messages
5. Check AWS console for resource status

## Success Criteria

Infrastructure is ready when:
- [ ] Terraform apply completes without errors
- [ ] EB environment shows "Green" health status
- [ ] `curl https://api.example.gov/health` returns `{"status":"ok"}`
- [ ] Frontend loads at CloudFront URL or custom domain
- [ ] WebSocket collaboration works (test by creating a document)
- [ ] Database queries succeed (check API logs)
- [ ] All CloudWatch log groups receiving data

**Total setup time:** 30-45 minutes from start to working application
