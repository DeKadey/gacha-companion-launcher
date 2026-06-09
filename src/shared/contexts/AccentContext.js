import { createContext, useContext } from 'react';

export const AccentContext = createContext('#7c6af7');
export const useAccent = () => useContext(AccentContext);
