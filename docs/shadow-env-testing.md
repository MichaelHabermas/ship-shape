# Shadow Environment Testing Guide

## Overview

The shadow environment is an isolated copy of the dev environment used for testing significant changes (like UDM v2 migrations) before applying them to production.

## Environment Details

| Environment | Database Host | App URL |
|-------------|--------------|---------|
| Dev (Source) | `ship-dev-aurora.cluster-cah0qe8uir1k.us-east-1.rds.amazonaws.com` | https://dev.ship.awsdev.treasury.gov |
| Shadow (Target) | `ship-shadow-aurora.cluster-cah0qe8uir1k.us-east-1.rds.amazonaws.com` | https://shadow.ship.awsdev.treasury.gov |

## Credentials

Credentials are stored in AWS SSM Parameter Store:
- `/ship/dev/*` - Dev environment parameters
- `/ship/shadow/*` - Shadow environment parameters

Fetch with:
```bash
aws ssm get-parameter --name "/ship/shadow/DB_PASSWORD" --with-decryption --query "Parameter.Value" --output text
```

## Database Copy Process

### Quick Copy (Recommended)

```bash
./scripts/copy-db-to-shadow.sh
```

This script:
1. Fetches credentials from SSM
2. Tests connections to both databases
3. Dumps dev database using pg_dump
4. Restores to shadow using psql
5. Runs migrations
6. Verifies data and checks test user

### Options

```bash
# Skip dump if you already have one
./scripts/copy-db-to-shadow.sh --use-dump /tmp/existing_dump.sql

# Skip migrations (if testing pre-migration state)
./scripts/copy-db-to-shadow.sh --skip-migrations

# Only verify current state
./scripts/copy-db-to-shadow.sh --verify-only
```

## Manual Database Operations

### Connect to Shadow DB

```bash
# Get credentials
SHADOW_HOST=$(aws ssm get-parameter --name "/ship/shadow/DB_HOST" --query "Parameter.Value" --output text)
SHADOW_PASS=$(aws ssm get-parameter --name "/ship/shadow/DB_PASSWORD" --with-decryption --query "Parameter.Value" --output text)

# Connect
PGPASSWORD="$SHADOW_PASS" psql -h "$SHADOW_HOST" -U postgres -d ship_main
```

### Run Migrations Manually

```bash
export DATABASE_URL=$(aws ssm get-parameter --name "/ship/shadow/DATABASE_URL" --with-decryption --query "Parameter.Value" --output text)
cd api && npx tsx src/db/migrate.ts
```

## Deployment

### Deploy API to Shadow

```bash
./scripts/deploy.sh shadow
```

### Deploy Frontend to Shadow

```bash
./scripts/deploy-web.sh shadow
```

### Full Deploy

```bash
./scripts/deploy.sh shadow
```

## Testing Checklist

After copying the database and deploying:

- [ ] Login works with test user (shawn.jones@treasury.gov)
- [ ] Documents load correctly
- [ ] Sidebar navigation works
- [ ] Associations display properly
- [ ] Create/edit/delete operations work
- [ ] Week assignments work
- [ ] Real-time collaboration works (WebSocket)

## Troubleshooting

### Cannot connect to database

1. Check VPN is connected
2. Verify security group allows your IP
3. Check credentials are correct

### Migration failures

1. Check `schema_migrations` table for applied migrations
2. Review migration file for syntax errors
3. Run migrations with verbose output:
   ```bash
   DEBUG=* npx tsx src/db/migrate.ts
   ```

### User cannot login

1. Verify user exists: `SELECT * FROM users WHERE email = 'user@example.gov';`
2. Check password hash is set (not NULL)
3. Verify password with: `SELECT crypt('password', password_hash) = password_hash FROM users WHERE email = 'user@example.gov';`
