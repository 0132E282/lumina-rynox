# zalo-bridge

Sidecar Node (`node:http`, phụ thuộc duy nhất `zca-js@2.2.0`) nối Laravel với Zalo cá nhân (kênh không chính thức). Chỉ lắng nghe `127.0.0.1`; mọi request hai chiều với Laravel đều ký HMAC-SHA256.

## Chạy

```bash
cd zalo-bridge
npm install
npm start          # node --env-file=../.env src/index.mjs (cần Node >= 20.6; khuyến nghị 24)
npm test           # node --test, không gọi mạng
```

Thiếu `ZALO_BRIDGE_SECRET` thì tiến trình thoát mã 1. Sidecar không ghi credentials, ảnh QR hay nội dung tin ra log/đĩa; phiên đăng nhập chỉ nằm trong bộ nhớ và được Laravel lưu mã hoá.

## Biến môi trường (đọc từ `.env` gốc)

| Biến                       | Mặc định                | Ý nghĩa                                   |
| -------------------------- | ----------------------- | ----------------------------------------- |
| `ZALO_BRIDGE_SECRET`       | (bắt buộc)              | Khoá dùng chung với Laravel để ký HMAC    |
| `ZALO_BRIDGE_PORT`         | `3790`                  | Cổng lắng nghe (luôn bind 127.0.0.1)      |
| `ZALO_BRIDGE_CALLBACK_URL` | `http://127.0.0.1:8000` | Địa chỉ Laravel để gọi `/internal/zalo/*` |
| `ZALO_BRIDGE_SEND_GAP_MS`  | `2000`                  | Khoảng cách tối thiểu giữa hai tin gửi đi |

## Chữ ký

Header `X-Bridge-Timestamp` (giây Unix) và `X-Bridge-Signature` = `hex(HMAC-SHA256(secret, "{ts}.{METHOD}.{path}.{rawBody}"))`, `path` gồm query string. Lệch quá 300 giây hoặc sai chữ ký thì bị từ chối. Vector dùng chung với PHP: `test/fixtures/hmac-vectors.json`.

## Nhiều tài khoản

Mỗi tài khoản Zalo là một phiên `ZaloSession` riêng (credential, listener, hàng đợi gửi cách nhau `SEND_GAP_MS`, cache danh bạ) do `SessionManager` giữ, khoá là uid Zalo. QR đang chờ được tra theo `login_id`; đăng nhập xong phiên mới vào bảng theo uid (đăng nhập lại cùng uid thì thay phiên cũ). Mọi endpoint nhận khoá tài khoản (`account`: query với GET, body với POST); callback về Laravel (`status`, `inbound`, `session`) cũng mang khoá. Tương thích ngược: không gửi `account` thì chỉ hợp lệ khi đang có đúng một phiên (nhiều hơn: 422 `invalid`; không có: 409 `not_logged_in`). Khi khởi động, sidecar hỏi `GET /internal/zalo/accounts` rồi khôi phục lần lượt từng phiên (cách nhau 2 giây). Chưa thử với nhiều phiên Zalo thật: giới hạn đăng nhập đồng thời/rate limit của Zalo chưa kiểm chứng.

## API (Laravel -> sidecar)

`GET /health[?account=]`, `POST /qr/start`, `GET /qr/status?login_id=` (có `account_key` khi `logged_in`), `POST /qr/cancel`, `POST /send` (`account`), `GET /contacts?account=` (danh bạ bạn bè + nhóm, cache 5 phút theo tài khoản), `POST /logout` (`account`). Chi tiết hợp đồng nằm ở `docs/plans/zalo-qr-channel-20261027.json` (technicalSolution mục 3-6).
