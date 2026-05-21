# Initial Deployment Plan Temp

Status: temporary working plan. Delete when replaced by the real runbook.

## Goal

Deploy ShipShape to the AWS path already reflected in the repo:

- API: Elastic Beanstalk, deployed by `./scripts/deploy.sh <dev|shadow|prod>`.
- Web: S3 + CloudFront, deployed by `./scripts/deploy-web.sh <dev|shadow|prod>`.
- Database: Aurora PostgreSQL, provisioned by Terraform and configured through SSM.
- Config/secrets: SSM Parameter Store plus Secrets Manager for CAIA OAuth.
- First real target: `shadow` UAT before `prod`.

The plan is intentionally conservative. The risky part is not AWS itself; it is the repo's current split-brain Terraform story and one deploy script path that can mutate infrastructure while pretending to be an app deploy.

## What We Already Decided

Use the repo scripts instead of hand-clicking AWS resources:

- `scripts/sync-terraform-config.sh` pulls environment config from SSM into generated `terraform.tfvars`.
- `scripts/terraform.sh` wraps Terraform for environment-aware operations.
- `scripts/deploy.sh` builds and deploys the API bundle to EB.
- `scripts/deploy-web.sh` builds and deploys `web/dist` to S3, then invalidates CloudFront.
- `scripts/copy-db-to-shadow.sh` and `scripts/copy-db-via-ssm.sh` are shadow-data tools, now documented as fail-closed after the prior fake-green risk.

Keep deployment sequencing:

1. Prove local build/test health.
2. Confirm AWS credentials and Terraform state.
3. Resolve the Terraform source-of-truth question before infra changes.
4. Deploy or verify infrastructure.
5. Deploy API.
6. Deploy web.
7. Verify in browser, not just with curl.
8. Only then repeat for production.

## Non-Negotiable Preflight

Before any AWS mutation:

1. Confirm the target environment: `shadow` first, then `prod`.
2. Run `git status --short` and know what is being deployed.
3. Run `aws sts get-caller-identity` and confirm the account/role is the expected one.
4. Confirm whether production Terraform source of truth is root `terraform/` or `terraform/environments/prod/`.
5. Refuse to run an app deploy if it would auto-run `terraform apply -auto-approve`.
6. Verify Terraform backend state bucket comes from `/ship/terraform-state-bucket`.

The critical unresolved item is item 4. Current script behavior says:

- `prod` uses root `terraform/`.
- `dev` and `shadow` use `terraform/environments/<env>`.
- `terraform/README.md` recommends environment directories and says root `terraform/` is legacy prod-only.

That is survivable only if we explicitly choose the root `terraform/` stack as current production truth for this deployment. If we instead choose `terraform/environments/prod`, scripts need alignment before prod deploy.

## Minimum Tooling

Required local CLIs:

- `pnpm`: build, type-check, package scripts.
- `docker`: pre-deploy API container build/import check inside `scripts/deploy.sh`.
- `aws`: SSM, S3, CloudFront, Elastic Beanstalk, STS, optional Secrets Manager.
- `terraform`: infrastructure plan/output/apply.
- `psql`/PostgreSQL client tools: database verification and optional shadow copy.
- `jq`: useful for AWS JSON output and `configure-caia.sh`.

Repo scripts to prefer over raw commands:

- `./scripts/sync-terraform-config.sh <dev|shadow|prod>`
- `./scripts/terraform.sh <dev|prod> <command>`
- `./scripts/deploy.sh <dev|shadow|prod>`
- `./scripts/deploy-web.sh <dev|shadow|prod>`
- `./scripts/copy-db-to-shadow.sh`
- `./scripts/copy-db-via-ssm.sh`
- `./scripts/configure-caia.sh <dev|prod>`

MCPs/connectors available in this session:

- Browser: use after deploy for real UI verification and screenshots.
- Computer Use: backup only if local GUI interaction is needed.
- Render, Canva, Slack, Notion, Documents, Spreadsheets: not relevant to AWS deployment.

There is no AWS MCP visible in this session. Minimum intervention path is therefore CLI-first: I can run local checks and repo scripts, then ask you only for AWS credential/session help, Terraform approval points, and any secrets I should not see or type.

## Phase 0: Read-Only Recon

Commands:

```bash
git status --short
aws sts get-caller-identity
terraform version
aws --version
docker --version
pnpm --version
```

Read-only AWS checks:

```bash
aws ssm get-parameter --name /ship/terraform-state-bucket --query Parameter.Value --output text
./scripts/sync-terraform-config.sh shadow
./scripts/terraform.sh dev output
```

For prod, do not assume `./scripts/terraform.sh prod output` is harmless until we confirm it is reading the intended root state.

Expected result:

- AWS auth works.
- Terraform backend bucket exists.
- Shadow config can sync.
- Terraform outputs include at least `s3_bucket_name` and `cloudfront_distribution_id` for web deployment, plus EB outputs for API deployment.

## Phase 1: Local Release Gate

Commands:

```bash
pnpm type-check
pnpm build
pnpm audit --prod --audit-level low
```

Optional evidence checks, depending on how much confidence we need before touching AWS:

```bash
pnpm test
pnpm openapi:check
pnpm benchmark:api
```

Do not run raw `pnpm test:e2e`; use the repo's controlled E2E runner path if E2E is needed.

Expected result:

- Build artifacts are fresh.
- API build includes `api/dist/db/schema.sql`.
- API build includes all migration files.
- No production dependency advisories.

## Phase 2: Terraform Source-of-Truth Decision

Decision needed from us before production:

- Recommended for initial deployment: treat current script behavior as truth and use root `terraform/` for `prod`, because that is what `deploy.sh`, `deploy-web.sh`, and `terraform.sh prod` currently target.
- Defer migration to `terraform/environments/prod` until after this deployment, unless we decide to align scripts first.

Shadow can proceed through `terraform/environments/shadow` because both deploy scripts already target that directory.

Read-only validation:

```bash
./scripts/sync-terraform-config.sh shadow
cd /Users/michaelhabermas/repos/GAI/ship-shape/terraform/environments/shadow
terraform init
terraform plan
terraform output
```

For prod current-script path:

```bash
./scripts/sync-terraform-config.sh prod
cd /Users/michaelhabermas/repos/GAI/ship-shape/terraform
terraform init
terraform plan
terraform output
```

Do not apply yet. Plan first, inspect, then explicitly approve.

## Phase 3: Infrastructure

If shadow infrastructure already exists, do not run `apply`; use outputs and move to app deploy.

If shadow infrastructure is missing:

```bash
cd /Users/michaelhabermas/repos/GAI/ship-shape/terraform/environments/shadow
terraform init
terraform plan -out=tfplan
terraform apply tfplan
```

For prod, same shape but only after the source-of-truth decision:

```bash
cd /Users/michaelhabermas/repos/GAI/ship-shape/terraform
terraform init
terraform plan -out=tfplan
terraform apply tfplan
```

Human approval required:

- Any Terraform apply.
- Any planned replacement/deletion.
- Any IAM, network, database, or domain change that is not expected.

## Phase 4: Shadow Database

If shadow needs production-like data:

```bash
./scripts/copy-db-to-shadow.sh
```

or, if SSM port forwarding is required:

```bash
./scripts/copy-db-via-ssm.sh
```

Expected guardrails:

- Restore failures fail the script.
- User and document counts must match before success.
- Explicit `DATABASE_URL` wins during migrations, so shadow migration does not silently target prod.

If shadow can start clean, skip copy and seed only the minimum data needed for verification.

## Phase 5: Deploy API To Shadow

Before running the script, check whether Terraform output can resolve the S3 bucket:

```bash
cd /Users/michaelhabermas/repos/GAI/ship-shape/terraform/environments/shadow
terraform output -raw s3_bucket_name
```

If that output is missing, stop. Do not let `scripts/deploy.sh` compensate by applying Terraform implicitly.

Deploy:

```bash
cd /Users/michaelhabermas/repos/GAI/ship-shape
./scripts/deploy.sh shadow
```

What the script does:

- Syncs Terraform config from SSM.
- Builds shared and API packages.
- Verifies SQL and migrations are copied.
- Builds the Docker image.
- Verifies the container imports successfully.
- Zips the EB bundle.
- Uploads it to S3.
- Creates an EB application version.
- Updates the EB environment.

Monitor:

```bash
aws elasticbeanstalk describe-environments --environment-names ship-api-shadow --query 'Environments[0].[Health,HealthStatus,Status,CNAME]' --output table
```

## Phase 6: Deploy Web To Shadow

Before running:

```bash
cd /Users/michaelhabermas/repos/GAI/ship-shape/terraform/environments/shadow
terraform output -raw s3_bucket_name
terraform output -raw cloudfront_distribution_id
```

Deploy:

```bash
cd /Users/michaelhabermas/repos/GAI/ship-shape
./scripts/deploy-web.sh shadow
```

What the script does:

- Syncs Terraform config from SSM.
- Builds `web/dist`.
- Syncs to S3 with delete.
- Invalidates CloudFront.
- Waits for invalidation completion.

## Phase 7: Shadow Verification

CLI checks:

```bash
curl -I https://shadow.ship.awsdev.treasury.gov
curl -s https://shadow.ship.awsdev.treasury.gov/health
```

Browser checks:

- Open `https://shadow.ship.awsdev.treasury.gov`.
- Login.
- Open `/docs`, `/issues`, `/my-week`, `/projects`.
- Create or edit a throwaway document.
- Verify TipTap content saves.
- Verify WebSocket collaboration does not fail through CloudFront.
- Check console for runtime errors.
- Check network for failed `/api/*` calls.

If WebSocket fails through CloudFront, use `docs/solutions/websocket-cloudfront-configuration.md` as the fix path. The fallback is a direct EB WebSocket URL through `VITE_WS_URL`, but that likely needs HTTPS on the EB ALB.

## Phase 8: Production Repeat

Production repeats the same sequence only after shadow passes:

1. Confirm prod Terraform source of truth.
2. Confirm AWS account/role.
3. Confirm prod Terraform output exists.
4. Confirm no implicit `terraform apply` path will run from app deploy.
5. Deploy API with `./scripts/deploy.sh prod`.
6. Deploy web with `./scripts/deploy-web.sh prod`.
7. Verify production in browser.

Current production endpoints from existing docs:

- API health: `http://ship-api-prod.eba-xsaqsg9h.us-east-1.elasticbeanstalk.com/health`
- Web: `https://ship.awsdev.treasury.gov`

## Minimal Intervention Model

What I can do with minimal help:

- Run local build/type/audit checks.
- Read Terraform plans and deployment output.
- Run repo scripts once AWS auth is available.
- Monitor EB, S3, CloudFront, and SSM through AWS CLI.
- Use Browser MCP for post-deploy verification.
- Produce a final evidence note from command output and browser checks.

Where I need you:

- Confirm the intended AWS account/role when `aws sts get-caller-identity` prints it.
- Re-authenticate AWS if local credentials are expired.
- Approve Terraform apply, especially for prod.
- Provide or confirm secrets that should stay outside chat/history.
- Decide the prod Terraform source of truth if the root-vs-environment conflict blocks us.

## 10x Option

Before the real production deploy, remove the hidden blast-radius path from `scripts/deploy.sh`: app deploy should fail if Terraform outputs are missing, not run `terraform apply -auto-approve`.

That is small, high-leverage, and deployment-specific. It turns a dangerous surprise into an explicit infrastructure step.

## Open Questions

1. Is `shadow` already provisioned, or do we need Terraform apply there?
2. Is production intentionally root `terraform/` for this deployment?
3. Do we need CAIA OAuth configured before first shadow verification?
4. Is `shadow.ship.awsdev.treasury.gov` the correct UAT URL for browser verification?
5. Are WebSocket CloudFront behaviors already applied in Terraform state?
