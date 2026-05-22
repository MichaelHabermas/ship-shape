/** Single JSON parse boundary — `unknown` cast contained here only. */
export async function readJson<T>(response: Response): Promise<T> {
  const data = (await response.json()) as unknown;
  return data as T;
}
