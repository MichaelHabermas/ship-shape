export function requireFirstRow<T>(rows: T[], message = 'Expected at least one row'): T {
  const row = rows[0];
  if (row === undefined) {
    throw new Error(message);
  }
  return row;
}
