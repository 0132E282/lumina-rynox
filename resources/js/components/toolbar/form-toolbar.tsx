import { Save, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function FormToolbar({
    formId,
    isSubmitting,
    onDelete,
}: {
    formId: string;
    isSubmitting: boolean;
    onDelete: () => void;
}) {
    return (
        <>
            <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={onDelete}
            >
                <Trash2 className="size-4" />
                Xóa
            </Button>
            <Button
                type="submit"
                form={formId}
                size="sm"
                disabled={isSubmitting}
            >
                <Save className="size-4" />
                {isSubmitting ? 'Đang cập nhật...' : 'Cập nhật'}
            </Button>
        </>
    );
}
