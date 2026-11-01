type SidebarLayoutProps = {
    children: React.ReactNode;
    Sidebar: React.ReactNode;
};

export default function SidebarLayout({
    children,
    Sidebar,
}: SidebarLayoutProps) {
    return (
        <div className="flex h-screen overflow-hidden bg-white">
            <aside className="w-64 flex-shrink-0 overflow-y-auto bg-gray-100 p-4">
                {Sidebar}
            </aside>

            <main className="flex-1 overflow-y-auto p-4">{children}</main>
        </div>
    );
}
