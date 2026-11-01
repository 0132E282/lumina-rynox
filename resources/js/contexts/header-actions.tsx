import { createContext, useContext, useEffect, useState } from 'react';
import type { DependencyList, ReactNode } from 'react';

type HeaderActionsContextValue = {
    actions: ReactNode;
    setActions: (actions: ReactNode) => void;
};

const HeaderActionsContext = createContext<HeaderActionsContextValue | null>(
    null,
);

export function HeaderActionsProvider({ children }: { children: ReactNode }) {
    const [actions, setActions] = useState<ReactNode>(null);

    return (
        <HeaderActionsContext.Provider value={{ actions, setActions }}>
            {children}
        </HeaderActionsContext.Provider>
    );
}

export function useHeaderActionsSlot() {
    const context = useContext(HeaderActionsContext);

    if (!context) {
        throw new Error(
            'useHeaderActionsSlot must be used within a HeaderActionsProvider',
        );
    }

    return context.actions;
}

export function useHeaderActions(actions: ReactNode, deps: DependencyList) {
    const context = useContext(HeaderActionsContext);

    if (!context) {
        throw new Error(
            'useHeaderActions must be used within a HeaderActionsProvider',
        );
    }

    const { setActions } = context;

    useEffect(() => {
        setActions(actions);

        return () => setActions(null);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, deps);
}
