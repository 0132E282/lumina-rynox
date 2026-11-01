import { createContext, useContext } from 'react';

type AiPanelState = [open: boolean, setOpen: (open: boolean) => void];

/** * Open/closed state of the right-hand AI panel, shared by the layout and the header button. */
export const AiPanelContext = createContext<AiPanelState | null>(null);

export function useAiPanel(): AiPanelState | null {
    return useContext(AiPanelContext);
}
