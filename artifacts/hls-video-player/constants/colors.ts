/**
 * Semantic design tokens for the mobile app.
 *
 * These tokens mirror the naming conventions used in web artifacts (index.css)
 * so that multi-artifact projects share a cohesive visual identity.
 *
 * Replace the placeholder values below with values that match the project's
 * brand. If a sibling web artifact exists, read its index.css and convert the
 * HSL values to hex so both artifacts use the same palette.
 *
 * To add dark mode, add a `dark` key with the same token names.
 * The useColors() hook will automatically pick it up.
 */

const colors = {
  light: {
    text: '#f7f8fb',
    tint: '#ff725c',
    background: '#0d1020',
    foreground: '#f7f8fb',
    card: '#171b2d',
    cardForeground: '#f7f8fb',
    primary: '#ff725c',
    primaryForeground: '#17111b',
    secondary: '#242941',
    secondaryForeground: '#f7f8fb',
    muted: '#20253a',
    mutedForeground: '#9ba3bd',
    accent: '#a8e6cf',
    accentForeground: '#13231f',
    destructive: '#ff625f',
    destructiveForeground: '#ffffff',
    border: '#2d3450',
    input: '#252c45',
    overlay: '#111528',
    videoBackground: '#080a12',
    success: '#a8e6cf',
    warning: '#ffd166',
  },
  dark: {
    text: '#f7f8fb',
    tint: '#ff725c',
    background: '#0d1020',
    foreground: '#f7f8fb',
    card: '#171b2d',
    cardForeground: '#f7f8fb',
    primary: '#ff725c',
    primaryForeground: '#17111b',
    secondary: '#242941',
    secondaryForeground: '#f7f8fb',
    muted: '#20253a',
    mutedForeground: '#9ba3bd',
    accent: '#a8e6cf',
    accentForeground: '#13231f',
    destructive: '#ff625f',
    destructiveForeground: '#ffffff',
    border: '#2d3450',
    input: '#252c45',
    overlay: '#111528',
    videoBackground: '#080a12',
    success: '#a8e6cf',
    warning: '#ffd166',
  },
  radius: 18,
};

export default colors;
