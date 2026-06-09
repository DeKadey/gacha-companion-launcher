import { createContext, useContext } from 'react';

export const ThemeContext = createContext('dark');
export const useTheme = () => useContext(ThemeContext);
