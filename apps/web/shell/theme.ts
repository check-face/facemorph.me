// The MUI theme equivalent to classic src/App.fs createTheme/ThemedApp: light and dark palettes chosen by the
// system colour scheme, Nunito headings and Roboto text.
import { createTheme, type Theme } from '@mui/material/styles';

declare module '@mui/material/styles' {
  interface TypeBackground {
    level2: string;
  }
}

const headings = "'Nunito', 'Segoe UI', sans-serif";

export function appTheme(dark: boolean): Theme {
  return createTheme({
    palette: {
      mode: dark ? 'dark' : 'light',
      background: {
        default: dark ? '#17181c' : '#fff',
        paper: dark ? '#353535' : '#fff',
        level2: dark ? '#2a2a2a' : '#f5f5f5',
      },
    },
    typography: {
      fontFamily: "'Roboto', 'Segoe UI', sans-serif",
      h1: { fontFamily: headings },
      h2: { fontFamily: headings },
      h3: { fontFamily: headings },
      h4: { fontFamily: headings },
      subtitle1: { fontFamily: headings },
      body2: { fontSize: '1rem' },
    },
  });
}

export const lightTheme = appTheme(false);
export const darkTheme = appTheme(true);
