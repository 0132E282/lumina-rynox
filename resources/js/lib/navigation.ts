export type IntegrationStatus = 'connected' | 'error' | 'disconnected';

export type NavItem = {
    title: string;
    url: string;
    icon?: string;
    badge?: number;
};

export type NavGroup = {
    key: string;
    title: string;
    icon?: string;
    /** * Rendered as one secondary menu holding the items, not as flat entries. */
    submenu?: boolean;
    items: NavItem[];
};

export type NavigationConfig = {
    main: NavGroup[];
};
