export type PageLayout = 'left-sidebar' | 'right-sidebar' | 'full-width';

export type PageItem = {
    id: string;
    name: string;
    slug: string;
    layout: PageLayout;
    fields: number;
    updatedAt: string;
};

export type PageGroup = {
    id: string;
    name: string;
    pages: PageItem[];
};

export const PAGE_GROUPS: PageGroup[] = [
    {
        id: 'general',
        name: 'Nội dung chung',
        pages: [
            {
                id: 'home',
                name: 'Trang chủ (Home)',
                slug: 'home',
                layout: 'full-width',
                fields: 4,
                updatedAt: '17/07/2026',
            },
            {
                id: 'about',
                name: 'Giới thiệu (About)',
                slug: 'about',
                layout: 'left-sidebar',
                fields: 6,
                updatedAt: '16/07/2026',
            },
        ],
    },
    {
        id: 'blog',
        name: 'Blog',
        pages: [
            {
                id: 'blog-post',
                name: 'Bài viết (Blog Post)',
                slug: 'blog-post',
                layout: 'right-sidebar',
                fields: 8,
                updatedAt: '14/07/2026',
            },
        ],
    },
    {
        id: 'shop',
        name: 'Sản phẩm',
        pages: [
            {
                id: 'product',
                name: 'Sản phẩm (Product)',
                slug: 'product',
                layout: 'right-sidebar',
                fields: 5,
                updatedAt: '10/07/2026',
            },
        ],
    },
];

export const LAYOUT_LABEL: Record<PageLayout, string> = {
    'left-sidebar': 'Thanh bên Trái',
    'right-sidebar': 'Thanh bên Phải',
    'full-width': 'Full Width',
};
