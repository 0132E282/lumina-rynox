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

    public const REVERT_CONFLICT = 'Không hoàn tác được: tệp đã được sửa tiếp sau thay đổi này. Xem lại thay đổi rồi dùng "Hoàn tác thay đổi" ở mục Thay đổi (về bản git) nếu muốn bỏ.';

    public const REVERT_UNAVAILABLE = 'Không hoàn tác được: tệp mới tạo hoặc thay đổi quá lớn để dựng lại bản cũ.';

    public const WRITE_FAILED = 'Không ghi được tệp.';

    public const NOTHING_TO_COMMIT = 'Không có thay đổi nào để commit.';

    public const COMMIT_FAILED = 'Không commit được. Kiểm tra tên/email git và hook của dự án.';

    public const NO_GITHUB_REMOTE = 'Dự án này chưa có remote GitHub (origin) để tạo Pull request.';

    public const BRANCH_FAILED = 'Không tạo được nhánh mới cho Pull request.';

    public const PUSH_FAILED = 'Không push được nhánh lên GitHub. Commit đã nằm trong nhánh mới trên máy; kiểm tra quyền git của bạn.';

    public const BAD_FOLDER = 'Thư mục không hợp lệ hoặc không tồn tại.';

    public const FOLDER_LINK = 'Đường dẫn có liên kết tượng trưng; hãy dùng đường dẫn thật của thư mục.';

    public const FOLDER_NOT_ALLOWED = 'Thư mục này nằm ngoài vị trí cho phép hoặc là vị trí nhạy cảm.';

    public const FOLDER_NOT_FOUND = 'Không tìm thấy thư mục “%s” trong khu vực được phép (%s, tối đa 7 cấp). Thư mục ở nơi khác thì thêm nơi đó vào AI_CHAT_LOCAL_IMPORT_BASES trong .env.';

    public const FOLDER_UNREADABLE = 'Máy chủ không đọc được thư mục %s (macOS có thể đang chặn quyền). Vào System Settings → Privacy & Security → Files and Folders (hoặc Full Disk Access) và cho ứng dụng chạy máy chủ quyền truy cập.';

    public const FOLDER_AMBIGUOUS = 'Có nhiều thư mục trùng tên và nội dung; hãy chọn thư mục cụ thể hơn.';

    public const FOLDER_DUPLICATE = 'Thư mục này đã được thêm.';

    public const NAME_TAKEN = 'Tên dự án đã tồn tại.';

    public const TOO_MANY_PROJECTS = 'Đã đạt số dự án tối đa.';

    public const TOO_MANY_FOLDERS = 'Mỗi dự án tối đa 5 thư mục.';

    /** @param string|null $field the request field the message belongs to (for the form) */
    public function __construct(string $message, public readonly int $status = 422, public readonly ?string $field = null)
    {
        parent::__construct($message);
    }
}
