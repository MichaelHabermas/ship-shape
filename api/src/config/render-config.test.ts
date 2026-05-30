import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';

describe('Render configuration', () => {
  it('runs migrations without generic database seeding during API deploys', () => {
    const renderYaml = readFileSync(resolve(process.cwd(), '../render.yaml'), 'utf8');

    expect(renderYaml).toContain('dist/db/migrate.js');
    expect(renderYaml).not.toContain('dist/db/seed.js');
  });
});
