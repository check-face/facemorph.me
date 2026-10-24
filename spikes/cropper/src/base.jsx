// Baseline: shared chrome + React with no cropper engine, to measure each prototype's own weight.
import React, { forwardRef } from 'react';
import { createRoot } from 'react-dom/client';
import { CropModal } from './shared.jsx';
const Empty = forwardRef(function Empty() { return null; });
createRoot(document.getElementById('root')).render(<CropModal Engine={Empty} name="base" />);
