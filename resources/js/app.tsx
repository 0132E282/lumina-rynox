import { createInertiaApp } from '@inertiajs/react';
import { resolvePageComponent } from 'laravel-vite-plugin/inertia-helpers';
import { createRoot, hydrateRoot } from 'react-dom/client';
import { route } from 'ziggy-js';
import { ConfirmDialogProvider } from '@/components/confirm-dialog';
import PasswordConfirmationGate from '@/components/password-confirmation-gate';
import { PromptDialogProvider } from '@/components/prompt-dialog';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { initializeTheme } from '@/hooks/use-appearance';
import AppLayout from '@/layouts/app-layout';
import AuthLayout from '@/layouts/auth-layout';
import '@/lib/i18n';

if (typeof window !== 'undefined') {
    window.route = route;
}

const appName = import.meta.env.VITE_APP_NAME || 'Laravel';

createInertiaApp({
    title: (title) => (title ? `${title} - ${appName}` : appName),
    resolve: (name): Promise<{ default: React.ComponentType }> => {
        const pages = import.meta.glob<{ default: React.ComponentType }>([
            './pages/**/*.tsx',
        ]);

        let path = `./pages/${name}.tsx`;

        if (!pages[path]) {
            const indexPath = `./pages/${name}/index.tsx`;

            if (pages[indexPath]) {
                path = indexPath;
            }
        }

        if (!pages[path]) {
            console.error(`Page not found: ${name} (path: ${path})`);

            return Promise.resolve({
                default: () => <div>Page not found: {name}</div>,
            });
        }

        const page = resolvePageComponent(path, pages);

        page.then((module: any) => {
            if (module.default.layout === undefined) {
                // * `?picker=1` embeds the page in FilePickerDialog's iframe without app chrome;
                // * checked inside the layout function because every navigation calls `.layout(page)` fresh.
                const isPickerEmbed = () =>
                    typeof window !== 'undefined' &&
                    new URLSearchParams(window.location.search).get(
                        'picker',
                    ) === '1';

                if (name.startsWith('auth/')) {
                    module.default.layout = (page: React.ReactNode) => (
                        <AuthLayout children={page} />
                    );
                } else if (name.startsWith('settings/')) {
                    module.default.layout = (page: React.ReactNode) =>
                        isPickerEmbed() ? page : <AppLayout children={page} />;
                } else {
                    module.default.layout = (page: React.ReactNode) =>
                        isPickerEmbed() ? page : <AppLayout children={page} />;
                }
            }
        });

        return page;
    },
    strictMode: true,
    setup({ el, App, props }) {
        const appElement = (
            <TooltipProvider delayDuration={0}>
                <ConfirmDialogProvider>
                    <PromptDialogProvider>
                        <App {...props} />
                        <PasswordConfirmationGate />
                        <Toaster />
                    </PromptDialogProvider>
                </ConfirmDialogProvider>
            </TooltipProvider>
        );

        if (typeof window === 'undefined') {
            return appElement;
        }

        if (!el) {
            return;
        }

        if (el.hasChildNodes()) {
            hydrateRoot(el, appElement);
        } else {
            createRoot(el).render(appElement);
        }
    },
    progress: {
        color: '#4B5563',
    },
});

initializeTheme();
