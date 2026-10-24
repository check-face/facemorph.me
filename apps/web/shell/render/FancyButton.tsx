// Classic src/FancyButton.fs: a contained MUI button over a slowly moving four-colour gradient.
import { keyframes } from '@emotion/react';
import Button, { type ButtonProps } from '@mui/material/Button';

const drift = keyframes`
  0% { background-position: 0% 50%; }
  50% { background-position: 100% 50%; }
  100% { background-position: 0% 50%; }
`;

export function FancyButton({ sx, ...props }: ButtonProps) {
  return (
    <Button
      {...props}
      sx={[
        {
          color: 'rgba(255,255,255,0.9)',
          background: 'linear-gradient(-45deg, #FFA63D, #FF3D77, #338AFF, #3CF0C5)',
          backgroundSize: '800%',
          backgroundPosition: '50% 100%', // where it rests if animation is unsupported
          animation: `${drift} 10s linear infinite`,
          transition: 'opacity 0.4s ease-out',
        },
        ...(Array.isArray(sx) ? sx : sx ? [sx] : []),
      ]}
    />
  );
}
