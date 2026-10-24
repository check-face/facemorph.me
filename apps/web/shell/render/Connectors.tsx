// Insertion connectors and the tile row (classic Product.fs connector, faceLabel, tilesWithConnectors, lines
// 957-977): a morph is a path, so the meaningful action is "insert here", and the connector is the only thing on
// the surface that draws a plus.
import AddIcon from '@mui/icons-material/Add';
import IconButton from '@mui/material/IconButton';
import type { ReactNode } from 'react';
import type { Input } from './types.ts';

export function Connector({ label, onAdd }: { label: string; onAdd: () => void }) {
  return (
    <div className="next-connector">
      <IconButton className="next-connector-add" aria-label={label} onClick={onAdd}>
        <AddIcon />
      </IconButton>
    </div>
  );
}

export function faceLabel(index: number): string {
  return index === 0 ? 'Morph from' : index === 1 ? 'Morph to' : `Face ${index + 1}`;
}

/** A connector before every tile and one after the last: [+ tile + tile ... +]. */
export function tilesWithConnectors(
  inputs: readonly Input[],
  tile: (item: Input, index: number, label: string) => ReactNode,
  onAddAt: (position: number) => void,
): ReactNode[] {
  const out: ReactNode[] = [];
  inputs.forEach((item, index) => {
    out.push(
      <Connector
        key={`add-${index}`}
        label={`Add a face before ${faceLabel(index)}`}
        onAdd={() => onAddAt(index)}
      />,
    );
    out.push(tile(item, index, faceLabel(index)));
  });
  out.push(
    <Connector
      key="add-end"
      label={`Add a face after Face ${inputs.length}`}
      onAdd={() => onAddAt(inputs.length)}
    />,
  );
  return out;
}
