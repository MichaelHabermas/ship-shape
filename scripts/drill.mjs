const [, , drillName] = process.argv;

if (drillName === 'ttfe') {
  console.error('TTFE drill placeholder: implementation is not wired yet.');
  process.exit(1);
}

console.error('Usage: pnpm drill ttfe');
process.exit(1);
