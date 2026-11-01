import { Head } from '@inertiajs/react';
import AppearanceToggleTab from '@/components/appearance-tabs';
import {
    Card,
    CardHeader,
    CardTitle,
    CardDescription,
    CardContent,
} from '@/components/ui/card';
import SettingsLayout from '@/layouts/settings/layout';

export default function Appearance() {
    return (
        <SettingsLayout>
            <Head title="Appearance settings" />

            <div className="max-w-full space-y-6">
                <Card>
                    <CardHeader>
                        <CardTitle>Appearance settings</CardTitle>
                        <CardDescription>
                            Update your account's appearance settings
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <AppearanceToggleTab />
                    </CardContent>
                </Card>
            </div>
        </SettingsLayout>
    );
}
