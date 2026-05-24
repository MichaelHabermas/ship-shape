# Ship - Deployment

The active public/demo deployment path is Render via `render.yaml`.

AWS/Terraform is intentionally preserved as a possible future government-style path. Treat it as legacy/future infrastructure guidance, not the current default deployment route.

## Current Path: Render

- API service: Render, configured from `render.yaml`
- Web service: Render, configured from `render.yaml`
- Reviewer evidence bundle: generated separately by `pnpm submission:render-bundle`

## Future Path: AWS/Terraform

Use this only when explicitly targeting Treasury-style infrastructure.

```bash
./scripts/deploy-infrastructure.sh
./scripts/deploy.sh dev        # or shadow|prod
./scripts/deploy-web.sh dev    # or shadow|prod
./scripts/init-database.sh
```

Architecture:

```text
Frontend (React) -> CloudFront -> S3
API (Express)    -> ALB -> Elastic Beanstalk -> Aurora PostgreSQL
                                             -> SSM Parameter Store
```

Deep reference:

- `terraform/README.md` is the canonical Terraform/AWS implementation guide.
- Archived duplicate planning docs live under `docs/archive/aws-deployment/`.

## Quick Checks

After any deployment, verify with a browser, not only `curl`.

- Render API: `https://ship-shape-api.onrender.com/health`
- Render Web: `https://ship-shape-web.onrender.com`
- AWS prod API: `http://ship-api-prod.eba-xsaqsg9h.us-east-1.elasticbeanstalk.com/health`
- AWS prod Web: `https://ship.awsdev.treasury.gov`
