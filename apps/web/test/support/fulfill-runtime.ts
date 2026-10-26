import type { APIRequestContext, Route } from 'playwright';

/** Keep runtime bytes on Playwright's shared response connection, outside trace action arguments. */
export async function fulfillRuntime(
  route: Route,
  request: APIRequestContext,
  url: string,
  headers: Record<string, string>,
): Promise<void> {
  const response = await request.get(url);
  try {
    await route.fulfill({ response, headers });
  } finally {
    await response.dispose();
  }
}
