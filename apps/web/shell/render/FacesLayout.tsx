// The faces area's content (classic Product.fs view, lines 1236-1266). N=2, the common case: classic's grid at
// >= 1000 px and a vertical stack below, with the morph between the two faces and the same insertion connector
// before, between and after the pair at every width (A-1). Any other count: the tile row with connectors, then
// the morph and video slots.
import AddIcon from '@mui/icons-material/Add';
import IconButton from '@mui/material/IconButton';
import type { ReactNode } from 'react';
import { tilesWithConnectors } from './Connectors.tsx';
import type { Input } from './types.ts';

export interface FacesLayoutProps {
  readonly inputs: readonly Input[];
  readonly tile: (item: Input, index: number, label: string) => ReactNode;
  readonly morphSlot: ReactNode;
  readonly videoSlot: ReactNode;
  readonly onAddAt: (position: number) => void;
}

const add = (className: string, label: string, onClick: () => void) => (
  <div className={`next-connector ${className}`}>
    <IconButton className="next-connector-add" aria-label={label} onClick={onClick}>
      <AddIcon />
    </IconButton>
  </div>
);

export function FacesLayout({ inputs, tile, morphSlot, videoSlot, onAddAt }: FacesLayoutProps) {
  const [first, second] = inputs;
  if (inputs.length === 2 && first && second) {
    return (
      <div className="next-morph-content n2">
        <div className="next-morph-cell next-morph-from">{tile(first, 0, 'Morph from')}</div>
        <div className="next-morph-cell next-morph-morph">{morphSlot}</div>
        <div className="next-morph-cell next-morph-to">{tile(second, 1, 'Morph to')}</div>
        <div className="next-morph-cell next-morph-vid">{videoSlot}</div>
        {add('next-connector-lead', 'Add a face before Morph from', () => onAddAt(0))}
        {add('next-connector-stack', 'Add a face between these two', () => onAddAt(1))}
        {add('next-connector-trail', 'Add a face after Morph to', () => onAddAt(2))}
      </div>
    );
  }
  return (
    <div className="next-morph-content n3">
      <div className="next-faces-row" data-next-face-count={inputs.length}>
        {tilesWithConnectors(inputs, tile, onAddAt)}
      </div>
      {morphSlot}
      {videoSlot}
    </div>
  );
}
