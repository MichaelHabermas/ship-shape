# Ship - AWS Infrastructure Plan (Archived)

> Archived duplicate. Keep for historical AWS/Terraform context. Current entry point: `DEPLOYMENT.md`; canonical deep reference: `terraform/README.md`.

**Government-compliant deployment for Express API + React frontend**

## Architecture Overview

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

## Cost Estimate

| Resource | Configuration | Monthly Cost |
|----------|--------------|--------------|
| Elastic Beanstalk | t3.small | ~$15 |
| Aurora Serverless v2 | 0.5 ACU min | ~$43 |
| ALB | Minimal traffic | ~$20 |
| CloudFront | 10GB transfer | ~$1 |
| S3 | Static hosting | ~$1 |
| SSM Parameters | Standard | Free |
| **Total** | | **~$80/month** |

## Directory Structure

```
ship/
├── terraform/                    # Infrastructure (deploy rarely)
│   ├── versions.tf               # Provider configuration
│   ├── variables.tf              # Input variables
│   ├── vpc.tf                    # VPC, subnets, NAT
│   ├── database.tf               # Aurora Serverless v2
│   ├── ssm.tf                    # SSM Parameter Store
│   ├── security-groups.tf        # Network security
│   ├── s3-cloudfront.tf          # Frontend hosting
│   └── outputs.tf                # Values for EB config
│
├── api/
│   ├── Dockerfile                # API container (ECR Public Node.js)
│   ├── .dockerignore
│   ├── .platform/                # Elastic Beanstalk config
│   │   └── nginx/
│   │       └── conf.d/
│   │           └── websocket.conf
│   └── .ebextensions/
│       ├── 01-env.config         # Environment variables
│       └── 02-cloudwatch.config  # Logging
│
├── web/
│   └── dist/                     # Build output (deploy to S3)
│
└── scripts/
    ├── deploy-infrastructure.sh  # Terraform deployment
    ├── deploy-api.sh             # EB CLI deployment
    └── deploy-web.sh             # S3 + CloudFront deployment
```

## Deployment Order

1. **Infrastructure** (Terraform) - Deploy once
2. **API** (EB CLI) - Deploy frequently
3. **Frontend** (S3 sync) - Deploy frequently

## Key Decisions

### Why Elastic Beanstalk for API?
- Native WebSocket support via ALB + sticky sessions
- Faster deploys (3-5 min vs 10-15 min with Fargate)
- Simpler configuration for monolithic Express app
- Lower cost ($15/month vs $30/month for Fargate)

### Why SSM Parameter Store (not Secrets Manager)?
- User requirement (government pattern preference)
- Sufficient for this use case
- Standard parameters are free
- Simpler IAM permissions

### Why Split Deployment (Terraform + EB CLI)?
- Terraform for infrastructure that rarely changes
- EB CLI (`eb deploy`) is fast for code changes
- Avoids CloudFormation doom loops

## Government Compliance

- ECR Public images (Docker Hub blocked)
- No Alpine images (use `-slim` variants)
- SSL strict mode disabled in Dockerfile
- CloudTrail enabled for audit logging
- VPC Flow Logs for network monitoring
- Encryption at rest (Aurora, S3)
