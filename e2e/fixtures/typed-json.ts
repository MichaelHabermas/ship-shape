// Typed JSON parsing for Playwright APIResponse and page.waitForResponse fetch bodies.
export type JsonResponseBody = {
  json(): Promise<unknown>;
};

export async function readJson(response: JsonResponseBody): Promise<unknown> {
  return await response.json();
}

export async function readJsonAs<T>(response: JsonResponseBody): Promise<T> {
  return (await readJson(response)) as T;
}
