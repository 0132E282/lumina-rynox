<?php

declare(strict_types=1);

namespace App\Services\Ai;

use RuntimeException;

/** * A refusal from the local workspace. Messages are fixed Vietnamese text and never contain a server path. */
final class LocalWorkspaceException extends RuntimeException
{
    public const DISABLED = 'Chưa bật kết nối local.';

    public const PRODUCTION = 'Kết nối local bị tắt trên môi trường production.';

    public const NOT_LOOPBACK = 'Kết nối local chỉ dùng được từ chính máy chạy ứng dụng (localhost).';

    public const UNKNOWN_ROOT = 'Thư mục gốc không có trong danh sách cho phép.';

    public const BAD_PATH = 'Đường dẫn không hợp lệ.';

    public const DENIED = 'Tệp này bị chặn vì có thể chứa bí mật hoặc thuộc thư mục hệ thống.';

    public const NOT_FOUND = 'Không tìm thấy tệp.';

    public const NOT_TEXT = 'Không đọc được tệp này (không phải văn bản UTF-8 nhỏ).';

    public const TOO_LARGE = 'Nội dung quá lớn.';

    public const CONFLICT = 'Tệp đã thay đổi kể từ lúc đề xuất. Hãy yêu cầu AI đề xuất lại.';

    public const WRITE_FAILED = 'Không ghi được tệp.';

    public function __construct(string $message, public readonly int $status = 422)
    {
        parent::__construct($message);
    }
}
