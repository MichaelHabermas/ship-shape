# Ship - AWS Deployment Checklist (Archived)

> Archived duplicate. Keep for historical AWS/Terraform context. Current entry point: `DEPLOYMENT.md`; canonical deep reference: `terraform/README.md`.

Quick reference for the optional AWS deployment path. The current public/demo deployment is Render via `render.yaml`.

## Initial Setup (One-time)

- [ ] Install tools: `terraform`, `awscli`, `awsebcli`, `postgresql@16`
- [ ] Configure AWS credentials: `aws configure`
- [ ] Copy `terraform/terraform.tfvars.example` to `terraform/terraform.tfvars`
- [ ] Edit `terraform/terraform.tfvars` with your configuration
- [ ] Deploy infrastructure: `./scripts/deploy-infrastructure.sh` (10-15 min)
- [ ] Initialize Elastic Beanstalk: `cd api && eb init`
- [ ] Create EB environment: See DEPLOYMENT.md for full `eb create` command (10-15 min)
- [ ] Initialize database: `./scripts/init-database.sh` (2-3 min)
- [ ] Deploy API: `./scripts/deploy-api.sh` (3-5 min)
- [ ] Deploy frontend: `./scripts/deploy-web.sh dev` (or `shadow|prod`)

**Total setup time:** ~30-45 minutes

## Regular Deployments (Frequent)

### Deploy API Changes
```bash
./scripts/deploy-api.sh              # legacy EB script (set EB_* env vars)
./scripts/deploy.sh dev              # or shadow|prod
```
**Time:** 3-5 minutes

### Deploy Frontend Changes
```bash
./scripts/deploy-web.sh dev   # or shadow|prod
```
**Time:** 2-3 minutes

### Deploy Both
```bash
./scripts/deploy-api.sh && ./scripts/deploy-web.sh dev
# AWS shadow (API + frontend):
./scripts/deploy.sh shadow && ./scripts/deploy-web.sh shadow
```
**Time:** 5-8 minutes

## Verification Steps

After deployment, verify:

- [ ] API health check: `curl https://api.example.gov/health`
- [ ] Frontend loads: Open `https://app.example.gov` in browser
- [ ] WebSocket works: Create a new document and test real-time collaboration
- [ ] Database connected: Check API logs for database connection messages
- [ ] CORS configured: Frontend can call API endpoints

## Common Tasks

### View Logs
```bash
cd api
eb logs                # Recent logs
eb logs --stream       # Stream logs
```

### Check Status
```bash
cd api
eb status              # Environment status
eb health              # Detailed health
```

### Update Environment Variables
```bash
# Update SSM parameter
aws ssm put-parameter --name "/ship/dev/DATABASE_URL" --type "SecureString" --value "..." --overwrite

# Restart EB to pick up changes
cd api
eb deploy --staged
```

### Apply Database Migration
```bash
DATABASE_URL=$(aws ssm get-parameter --name "/ship/dev/DATABASE_URL" --with-decryption --query "Parameter.Value" --output text)
pnpm --filter @ship/api db:migrate
```

### SSH to Instance
```bash
cd api
eb ssh
```

## Rollback Procedure

### Rollback API
```bash
cd api
eb deploy --version <previous-version>
```

### Rollback Frontend
```bash
# Find previous version
aws s3api list-object-versions --bucket ship-frontend-dev --prefix index.html

# Restore specific version
aws s3api get-object --bucket ship-frontend-dev --key index.html --version-id <VERSION_ID> index.html
aws s3 cp index.html s3://ship-frontend-dev/index.html

# Invalidate CloudFront
aws cloudfront create-invalidation --distribution-id <DIST_ID> --paths "/*"
```

## Monitoring Dashboards

- **CloudWatch Logs:**
  - `/aws/elasticbeanstalk/ship-api/application`
  - `/aws/elasticbeanstalk/ship-api/nginx`
  - `/aws/rds/cluster/ship-aurora/postgresql`

- **AWS Console:**
  - Elastic Beanstalk: Health and metrics
  - RDS: Aurora cluster performance
  - CloudFront: Cache statistics and errors

## Cost Monitoring

Check current month's costs:
```bash
aws ce get-cost-and-usage \
  --time-period Start=$(date -u -v1d +%Y-%m-%d),End=$(date -u +%Y-%m-%d) \
  --granularity MONTHLY \
  --metrics BlendedCost \
  --group-by Type=SERVICE
```

Expected costs (dev environment):
- Elastic Beanstalk (t3.small): ~$15/month
- Aurora Serverless v2 (0.5 ACU): ~$43/month
- ALB: ~$20/month
- S3 + CloudFront: ~$2/month
- **Total: ~$80/month**

## Emergency Contacts

When things go wrong:

1. **Database issues:** Check Aurora cluster health in RDS console
2. **API not responding:** Check EB environment health and logs
3. **Frontend not loading:** Check CloudFront distribution status
4. **WebSocket failing:** Check ALB target group health and sticky sessions

## Disaster Recovery

### Create Manual Backup
```bash
# Database snapshot
aws rds create-db-cluster-snapshot \
  --db-cluster-identifier ship-aurora \
  --db-cluster-snapshot-identifier ship-manual-backup-$(date +%Y%m%d)

# Frontend backup (already versioned in S3)
aws s3 sync s3://ship-frontend-dev s3://ship-frontend-backup/$(date +%Y%m%d)/
```

### Restore from Backup
See DEPLOYMENT.md "Disaster Recovery" section for detailed restore procedures.
