<?php

declare(strict_types=1);

namespace App\Services\Ai;

use RuntimeException;

/** * Fixed Vietnamese texts only: the GitHub response body, URL and token are never carried along. */
final class GithubException extends RuntimeException
{
    public const NOT_CONNECTED = 'Chưa kết nối GitHub.';

    public const UNAUTHORIZED = 'Token GitHub không hợp lệ hoặc đã hết hạn.';

    public const NOT_FOUND = 'Không tìm thấy repo, hoặc token chưa có quyền đọc repo này.';

    public const UNREACHABLE = 'Không kết nối được tới GitHub.';

    public const FAILED = 'GitHub trả về lỗi, hãy thử lại sau.';

    public const WRITE_DENIED = 'Token GitHub chưa có quyền ghi. Cần Contents và Pull requests: Read and write cho repo này.';

    public const REJECTED = 'GitHub từ chối thay đổi (file có thể đã đổi trên nhánh gốc). Hãy nhờ AI soạn lại.';

    public const BAD_REPO = 'Tên repo không hợp lệ.';
}
