export type HeaderPolicy = Readonly<Record<string, Readonly<Record<string, string>>>>;
export const POLICY: HeaderPolicy;
export function headersFor(path: string, policy?: HeaderPolicy): Record<string, string>;
export function headersText(policy?: HeaderPolicy): string;
