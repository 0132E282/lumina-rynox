import { Head } from '@inertiajs/react';
import {
    Copy,
    Eye,
    EyeOff,
    Key,
    Plus,
    ShieldAlert,
    Trash2,
} from 'lucide-react';
import { useState } from 'react';
import Heading from '@/components/heading';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from '@/components/ui/card';
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/utils';

interface ApiKeyItem {
    id: number;
    name: string;
    key: string;
    secret?: string;
    status: 'active' | 'revoked';
    last_used_at?: string | null;
    created_at: string;
}

export default function ApiKeysIndex({
    apiKeys: initialKeys,
}: {
    apiKeys: ApiKeyItem[];
}) {
    const [keys, setKeys] = useState<ApiKeyItem[]>(initialKeys ?? []);
    const [openModal, setOpenModal] = useState(false);
    const [keyName, setKeyName] = useState('');
    const [loading, setLoading] = useState(false);
    const [copiedKeyId, setCopiedKeyId] = useState<number | null>(null);
    const [visibleKeyIds, setVisibleKeyIds] = useState<Record<number, boolean>>(
        {},
    );

    const toggleShowKey = (id: number) => {
        setVisibleKeyIds((prev) => ({
            ...prev,
            [id]: !prev[id],
        }));
    };

    const handleCreateKey = async () => {
        if (!keyName.trim()) {
            return;
        }

        setLoading(true);

        try {
            const response = await api.post<{
                message: string;
                data: ApiKeyItem;
            }>('/api-keys', {
                name: keyName.trim(),
            });
            setKeys([response.data.data, ...keys]);
            setKeyName('');
            setOpenModal(false);
        } catch (error) {
            console.error('Failed to create API key', error);
        } finally {
            setLoading(false);
        }
    };

    const handleRevokeKey = async (id: number) => {
        if (!confirm('Bạn có chắc chắn muốn thu hồi API Key này?')) {
            return;
        }

        try {
            const response = await api.post<{
                message: string;
                data: ApiKeyItem;
            }>(`/api-keys/${id}/revoke`);
            setKeys(keys.map((k) => (k.id === id ? response.data.data : k)));
        } catch (error) {
            console.error('Failed to revoke API key', error);
        }
    };

    const handleDeleteKey = async (id: number) => {
        if (!confirm('Bạn có chắc chắn muốn xóa vĩnh viễn Key này?')) {
            return;
        }

        try {
            await api.delete(`/api-keys/${id}`);
            setKeys(keys.filter((k) => k.id !== id));
        } catch (error) {
            console.error('Failed to delete API key', error);
        }
    };

    const handleCopy = (text: string, id: number) => {
        navigator.clipboard.writeText(text);
        setCopiedKeyId(id);
        setTimeout(() => setCopiedKeyId(null), 2000);
    };

    return (
        <div className="flex flex-1 flex-col gap-6 p-4">
            <Head title="Quản lý API Keys" />

            <div className="flex flex-col gap-6">
                <div className="flex items-center justify-between">
                    <Heading
                        title="Public API Keys / SSH Keys"
                        description="Tạo và quản lý API Key. Key chưa được dùng để xác thực /api/items; API này chỉ dùng phiên đăng nhập."
                    />
                    <Button
                        onClick={() => setOpenModal(true)}
                        className="gap-2"
                    >
                        <Plus className="size-4" />
                        Tạo API Key mới
                    </Button>
                </div>

                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-base">
                            <Key className="size-4" />
                            Danh sách API Keys
                        </CardTitle>
                        <CardDescription>
                            Sử dụng các Key này trong Header `X-API-Key` hoặc
                            `Authorization: Bearer &lt;Key&gt;` khi gọi API.
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        {keys.length === 0 ? (
                            <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-8 text-center">
                                <ShieldAlert className="mb-2 size-10 text-muted-foreground" />
                                <p className="text-sm font-medium">
                                    Chưa có API Key nào được tạo
                                </p>
                                <p className="mt-1 text-xs text-muted-foreground">
                                    Bấm "Tạo API Key mới" ở trên để khởi tạo Key
                                    đầu tiên.
                                </p>
                            </div>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="w-full text-left text-sm">
                                    <thead>
                                        <tr className="border-b bg-muted/50 text-xs font-medium text-muted-foreground">
                                            <th className="p-3">Tên Key</th>
                                            <th className="p-3">
                                                API Key (X-API-Key)
                                            </th>
                                            <th className="p-3">Trạng thái</th>
                                            <th className="p-3">
                                                Lần dùng cuối
                                            </th>
                                            <th className="p-3">Ngày tạo</th>
                                            <th className="p-3 text-right">
                                                Thao tác
                                            </th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y">
                                        {keys.map((item) => (
                                            <tr
                                                key={item.id}
                                                className="hover:bg-muted/30"
                                            >
                                                <td className="p-3 font-medium">
                                                    {item.name}
                                                </td>
                                                <td className="p-3 font-mono text-xs">
                                                    <div className="flex items-center gap-2">
                                                        <span
                                                            className="cursor-pointer rounded bg-muted px-2 py-1 select-all"
                                                            onClick={() =>
                                                                toggleShowKey(
                                                                    item.id,
                                                                )
                                                            }
                                                            title={
                                                                visibleKeyIds[
                                                                    item.id
                                                                ]
                                                                    ? 'Bấm để ẩn Key'
                                                                    : 'Bấm để hiện Key'
                                                            }
                                                        >
                                                            {visibleKeyIds[
                                                                item.id
                                                            ]
                                                                ? item.key
                                                                : '••••••••••••••••••••••••••••••••'}
                                                        </span>
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            className="size-7"
                                                            onClick={() =>
                                                                toggleShowKey(
                                                                    item.id,
                                                                )
                                                            }
                                                            title={
                                                                visibleKeyIds[
                                                                    item.id
                                                                ]
                                                                    ? 'Ẩn Key'
                                                                    : 'Hiện Key'
                                                            }
                                                        >
                                                            {visibleKeyIds[
                                                                item.id
                                                            ] ? (
                                                                <EyeOff className="size-3.5" />
                                                            ) : (
                                                                <Eye className="size-3.5" />
                                                            )}
                                                        </Button>
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            className="size-7"
                                                            onClick={() =>
                                                                handleCopy(
                                                                    item.key,
                                                                    item.id,
                                                                )
                                                            }
                                                            title="Sao chép Key"
                                                        >
                                                            <Copy className="size-3.5" />
                                                        </Button>
                                                        {copiedKeyId ===
                                                            item.id && (
                                                            <span className="font-sans text-xs text-green-600">
                                                                Đã chép!
                                                            </span>
                                                        )}
                                                    </div>
                                                </td>
                                                <td className="p-3">
                                                    <Badge
                                                        variant={
                                                            item.status ===
                                                            'active'
                                                                ? 'default'
                                                                : 'destructive'
                                                        }
                                                    >
                                                        {item.status ===
                                                        'active'
                                                            ? 'Đang hoạt động'
                                                            : 'Đã thu hồi'}
                                                    </Badge>
                                                </td>
                                                <td className="p-3 text-xs text-muted-foreground">
                                                    {item.last_used_at
                                                        ? formatDateTime(
                                                              item.last_used_at,
                                                          )
                                                        : 'Chưa sử dụng'}
                                                </td>
                                                <td className="p-3 text-xs text-muted-foreground">
                                                    {formatDateTime(
                                                        item.created_at,
                                                    )}
                                                </td>
                                                <td className="p-3 text-right">
                                                    <div className="flex items-center justify-end gap-2">
                                                        {item.status ===
                                                            'active' && (
                                                            <Button
                                                                variant="outline"
                                                                size="sm"
                                                                onClick={() =>
                                                                    handleRevokeKey(
                                                                        item.id,
                                                                    )
                                                                }
                                                            >
                                                                Thu hồi
                                                            </Button>
                                                        )}
                                                        <Button
                                                            variant="destructive"
                                                            size="icon"
                                                            className="size-8"
                                                            onClick={() =>
                                                                handleDeleteKey(
                                                                    item.id,
                                                                )
                                                            }
                                                            title="Xóa Key"
                                                        >
                                                            <Trash2 className="size-4" />
                                                        </Button>
                                                    </div>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>

            <Dialog open={openModal} onOpenChange={setOpenModal}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Tạo API Key mới</DialogTitle>
                    </DialogHeader>

                    <div className="space-y-4 py-2">
                        <div className="space-y-2">
                            <Label htmlFor="key-name">
                                Tên / Mục đích sử dụng Key
                            </Label>
                            <Input
                                id="key-name"
                                placeholder="Ví dụ: App Mobile Khách Hàng, Frontend Web, Webhook Partner..."
                                value={keyName}
                                onChange={(e) => setKeyName(e.target.value)}
                                autoFocus
                            />
                        </div>
                    </div>

                    <DialogFooter>
                        <Button
                            variant="outline"
                            onClick={() => setOpenModal(false)}
                        >
                            Hủy
                        </Button>
                        <Button
                            onClick={handleCreateKey}
                            disabled={loading || !keyName.trim()}
                        >
                            {loading ? 'Đang tạo...' : 'Tạo Key'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
