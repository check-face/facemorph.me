// test/goldens/goldens.json: one index for every recorder's goldens. Each recorder owns its section (the control
// it recorded from, its command, browser and oracle) and its rows; writing one section keeps the others.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

export const INDEX = new URL('./goldens.json', import.meta.url);

export interface Row { readonly id: string; readonly freeze?: string; readonly [key: string]: unknown }
export interface Section { readonly control: unknown; readonly recorder: Record<string, unknown>; readonly rows: readonly Row[] }
export interface Index { schema: string; sections: Record<string, Section> }

export function readIndex(): Index {
  if (!existsSync(INDEX)) return { schema: 'facemorph.goldens/2', sections: {} };
  const parsed = JSON.parse(readFileSync(INDEX, 'utf8')) as Partial<Index> & { rows?: unknown };
  return parsed.sections ? (parsed as Index) : { schema: 'facemorph.goldens/2', sections: {} };
}

export function writeIndex(name: string, section: Section): void {
  const index = readIndex();
  index.sections[name] = section;
  writeFileSync(INDEX, JSON.stringify(index, null, 1) + '\n');
}
