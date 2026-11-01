<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Models\ZaloAccount;
use App\Services\Chat\Telegram\ChatUnavailableException;
use App\Services\Chat\Zalo\ZaloBridgeException;
use App\Services\Chat\Zalo\ZaloContactSync;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\JsonResponse;

/** * Manual "Đồng bộ danh bạ" of ONE Zalo account. Needs `integrations.update` and a tight throttle (route). Contact names are never logged. */
class ZaloContactsController extends Controller
{
    public function __construct(private readonly ZaloContactSync $sync) {}

    public function sync(ZaloAccount $account): JsonResponse
    {
        try {
            $result = $this->sync->sync($account);
        } catch (ChatUnavailableException $exception) {
            return $this->failure(409, $exception->getMessage());
        } catch (ConnectionException) {
            return $this->failure(503, 'Zalo bridge không chạy. Chạy npm --prefix zalo-bridge start rồi thử lại.');
        } catch (ZaloBridgeException $exception) {
            return $exception->status === 409
                ? $this->failure(409, 'Zalo bridge chưa đăng nhập hoặc đang kết nối lại, thử lại sau.')
                : $this->failure(502, 'Không lấy được danh bạ từ Zalo, hãy thử lại sau.');
        }

        return response()->json($result)->header('Cache-Control', 'no-store');
    }

    private function failure(int $status, string $message): JsonResponse
    {
        return response()->json(['message' => $message], $status)->header('Cache-Control', 'no-store');
    }
}
