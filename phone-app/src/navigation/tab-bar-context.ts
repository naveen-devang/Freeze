import { createContext } from 'react';

export const TabBarHiddenContext = createContext<(hidden: boolean) => void>(() => {});
