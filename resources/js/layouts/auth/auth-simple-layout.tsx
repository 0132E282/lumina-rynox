import type { AuthLayoutProps } from '@/types';

export default function AuthSimpleLayout({ children }: AuthLayoutProps) {
    return <div className="min-h-svh w-full bg-background">{children}</div>;
}
