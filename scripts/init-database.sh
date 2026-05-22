#!/bin/bash
set -e

echo "=========================================="
echo "Ship - Database Initialization"
echo "=========================================="
echo ""

# Navigate to project root
cd "$(dirname "$0")/.."

# Get database URL from SSM Parameter Store
echo "Fetching database connection from SSM Parameter Store..."
DATABASE_URL=$(aws ssm get-parameter --name "/ship/dev/DATABASE_URL" --with-decryption --query "Parameter.Value" --output text)

if [ -z "$DATABASE_URL" ]; then
    echo "Error: Could not fetch DATABASE_URL from SSM Parameter Store"
    echo "Make sure infrastructure is deployed and you have AWS credentials configured"
    exit 1
fi

echo "Database URL fetched successfully (credentials hidden)"
echo ""

# Export for use by psql
export DATABASE_URL

# Run migrations
echo "Running database migrations..."
pnpm --filter @ship/api db:migrate

echo ""
echo "Migrations applied successfully!"
echo ""

# Optionally seed database
read -p "Seed database with test data? (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "Seeding database..."
    pnpm --filter @ship/api db:seed
    echo "Database seeded successfully!"
fi

echo ""
echo "=========================================="
echo "Database initialization complete!"
echo "=========================================="
