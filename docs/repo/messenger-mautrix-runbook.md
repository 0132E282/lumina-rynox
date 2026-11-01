# Runbook: kênh Messenger cá nhân qua Matrix (Synapse) + mautrix-meta

> **Mọi bước dưới đây do NGƯỜI DÙNG tự làm trên máy của mình.** Agent/coder không cài, không chạy Synapse hay mautrix-meta, không dùng cookie Facebook thật ở bất kỳ bước nào của việc triển khai code (mọi test tự động dùng `Http::fake` với cookie giả). Tài liệu thiết kế: [`docs/design/messenger-personal-mautrix.md`](../design/messenger-personal-mautrix.md). Trạng thái code: triển khai xong theo `docs/plans/messenger-personal-mautrix-20261031.json` (TASK-001..007), `active = false` trong `config/integrations.php` cho tới khi bạn tự chạy xong bảng testcase ở cuối file và tự bật.

## Yêu cầu

- Docker (khuyến nghị) hoặc Python/Go cài tay, trên macOS arm64 hoặc Linux. Binary mautrix-meta chính thức chỉ có `linux amd64/arm/arm64` và `darwin-arm64`; không có Windows hay macOS Intel.
- Một tài khoản Facebook **phụ** (không dùng tài khoản chính), nên bật xác minh 2 bước.
- Laravel chạy với ít nhất 2 worker PHP đồng thời, vì đăng nhập cookie là một request đồng bộ có thể kéo dài tới ~30-60 giây (ví dụ `PHP_CLI_SERVER_WORKERS=4 php artisan serve`, hoặc php-fpm).
- Đã `php artisan migrate` và `php artisan permissions:generate` trên môi trường thử (bảng `integrations`/`conversations`/`chat_messages`/`settings` đã có sẵn, không cần migration mới cho tính năng này).

## 1) Dựng Matrix homeserver (Synapse)

1. Chạy Synapse bằng Docker, publish ra `127.0.0.1:8008` (không public ra ngoài), đặt `server_name` nội bộ, ví dụ `pm.local`. Đối chiếu tài liệu Synapse bản bạn đang dùng cho cú pháp `docker run`/`docker-compose` chính xác (không đưa vào repo).
2. Trong `homeserver.yaml`: tắt `federation` (không liên kết ra ngoài) và đặt `enable_registration: false` (không cho đăng ký công khai).
3. Khởi động Synapse, kiểm `curl http://127.0.0.1:8008/_matrix/client/versions` trả 200.

## 2) Tạo user Matrix cho Laravel

1. Dùng công cụ admin của Synapse (`register_new_matrix_user` hoặc tương đương) tạo user, ví dụ `@pm:pm.local`.
2. Lấy access token của user này (qua lệnh admin hoặc đăng nhập rồi đọc token từ client). Đây là `MATRIX_ACCESS_TOKEN` — không commit, không chia sẻ.

## 3) Cài mautrix-meta (bridgev2)

1. Tải bản release chính thức đã ghim phiên bản (không dùng bản `latest` trôi nổi); kiểm `sha256sums.txt` trước khi chạy.
2. Sinh file cấu hình mẫu (`-e` hoặc tương đương theo tài liệu bản bạn tải), rồi chỉnh các khoá chính:
   - `homeserver.address` = `http://127.0.0.1:8008`, `homeserver.domain` = `pm.local` (khớp `server_name`).
   - `appservice.address`/`hostname`/`port`: bind `127.0.0.1`.
   - `appservice.database`: `sqlite3-fk-wal` (nhẹ) hoặc Postgres 16+ nếu muốn bền hơn.
   - `bridge.permissions`: chỉ cấp quyền cho `@pm:pm.local` (mức `user` hoặc `admin` tuỳ bản); không cấp `*`.
   - `encryption.allow: false` (Laravel đọc tin dạng plaintext qua `/sync`).
   - `backfill.enabled: true` với `max_initial_messages` khoảng 50 (mỗi chat lấy ~50 tin gần nhất). Laravel lưu tin lịch sử từ người khác nhưng không tính chưa đọc và không đổi tin cuối nếu cũ hơn; tin của chính bạn bị bỏ (BR-005). Khoá cấu hình chính xác theo tài liệu bản mautrix-meta đang dùng.
   - `matrix.message_status_events: true` (để nhận sự kiện `com.beeper.message_send_status` cho tin đã gửi thất bại).
   - `provisioning.shared_secret`: chuỗi ngẫu nhiên đủ dài — đây là `MAUTRIX_META_PROVISIONING_SECRET`.
   - Đối chiếu tài liệu bản đang dùng xem có khoá chọn mạng (`network.mode` hay tương đương) cần đặt riêng cho Messenger hay không.
3. Sinh `registration.yaml` (`-g` hoặc tương đương), thêm đường dẫn file này vào `app_service_config_files` của Synapse, rồi khởi động lại Synapse.
4. Chạy mautrix-meta. Ghi lại `bot_user_id` trong `registration.yaml`/config (ví dụ `@metabot:pm.local`) — đây là `MAUTRIX_META_BOT_USER_ID`.
5. Kiểm Provisioning API đã chạy: `curl -H "Authorization: Bearer <shared_secret>" "http://127.0.0.1:29319/_matrix/provision/v3/logins?user_id=@pm:pm.local"` trả 200 (danh sách rỗng là bình thường trước khi đăng nhập).

## 4) Điền `.env` và khởi động Laravel

1. Điền trong `.env` (không commit): `MATRIX_HOMESERVER_URL`, `MATRIX_USER_ID`, `MATRIX_ACCESS_TOKEN`, `MAUTRIX_META_PROVISIONING_URL`, `MAUTRIX_META_PROVISIONING_SECRET`, `MAUTRIX_META_BOT_USER_ID`, `MAUTRIX_META_GHOST_PREFIX` (mặc định `@meta_`, khớp `username_template` của bridge nếu bạn đổi), `MAUTRIX_META_SEND_PER_MINUTE` (mặc định 10). Xem `.env.example` cho danh sách đầy đủ.
2. `php artisan config:clear`.
3. Chạy lệnh đồng bộ theo một trong hai cách:
   - Vòng lặp dưới supervisor/launchd (độ trễ nhận tin thấp hơn): `php artisan chat:matrix-sync`.
   - Hoặc để scheduler gọi `chat:matrix-sync --once` mỗi phút (đã khai báo sẵn trong `routes/console.php`; cần `php artisan schedule:work` hoặc cron gọi `schedule:run` mỗi phút chạy nền) — độ trễ nhận tin tối đa khoảng 1 phút.

## 5) Đăng nhập bằng tài khoản Facebook phụ

1. Mở `facebook.com` trên trình duyệt, đăng nhập bằng **tài khoản phụ**.
2. Mở Công cụ cho nhà phát triển > Application/Storage > Cookies > `https://www.facebook.com`, sao chép `c_user`, `xs`, `datr`, `sb` (và cookie khác nếu form báo thiếu) thành chuỗi `tên=giá_trị; tên=giá_trị`.
3. Vào `/integrations/messenger` trong app, tick "Tôi hiểu rủi ro", dán chuỗi cookie, bấm "Đăng nhập". Request này có thể mất tới khoảng 30-60 giây.
4. Thành công thì trang hiện "Đã đăng nhập: <tên tài khoản>". Không bấm "Đăng xuất" trên trình duyệt đã lấy cookie — việc đó làm cookie mất hiệu lực và kênh có thể mất kết nối (`BAD_CREDENTIALS`).

## 6) Bật kênh sau khi tự test xong

Sau khi chạy hết bảng testcase bên dưới và hài lòng với kết quả, tự sửa `config/integrations.php`: đặt `active => true` cho khoá `messenger`. Việc này không phải việc của agent/coder.

## Bảo mật và log (tóm tắt, xem thêm design mục 4.2–4.4)

- Laravel không bao giờ lưu cookie Facebook (DB/log/session/cache) — chỉ chuyển cho bridge trong một request đăng nhập rồi bỏ. `integrations.credentials` của `messenger` luôn `null`.
- `MATRIX_ACCESS_TOKEN`, `MAUTRIX_META_PROVISIONING_SECRET` chỉ nằm trong `.env` (không commit), không vào DB/props.
- Log bridge/homeserver ra stdout của tiến trình, không bật log debug có body ở production; không đổ log này vào log Laravel.
- File `config.yaml`, `registration.yaml` (có `as_token`/`hs_token`) và DB phiên của bridge: để ngoài repo, quyền file 600, không commit.
- Xoay vòng secret: đổi `provisioning.shared_secret` và `.env` cùng lúc, khởi động lại bridge; token Matrix thì tạo token mới và thu hồi token cũ.

## AGPL-3.0

mautrix-meta là AGPL-3.0. Chỉ chạy bản release/image chính thức, không sửa mã nguồn. Không commit binary/config/registration/DB của bridge vào repo. Phân phối bản đã đóng gói (vd desktop) kèm bridge thì cần tư vấn pháp lý riêng trước — đây không phải tư vấn pháp lý.

## Testcase thủ công (cần hạ tầng và tài khoản Facebook phụ thật)

Trạng thái: `Not Run` = chưa chạy. Chỉ đổi sang Pass/Fail sau khi thật sự chạy.

| ID    | Tên                                              | Các bước                                                                                             | Kết quả mong đợi                                                                                                                  | Trạng thái |
| ----- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| MX-01 | Đăng nhập cookie hợp lệ                          | Vào `/integrations/messenger`, tick rủi ro, dán cookie tài khoản phụ, bấm Đăng nhập                  | Trang báo đã kết nối kèm tên tài khoản; `/integrations` hiện thẻ Messenger đã kết nối                                             | Not Run    |
| MX-02 | Cookie thiếu `xs`                                | Dán chuỗi chỉ có `c_user`, bấm Đăng nhập                                                             | 422 báo thiếu cookie bắt buộc, không gọi tới bridge, không kết nối                                                                | Not Run    |
| MX-03 | Facebook yêu cầu xác minh thêm (2FA/checkpoint)  | Đăng nhập bằng tài khoản vừa bật 2FA hoặc đang bị Facebook yêu cầu xác minh                          | Trang báo "Facebook yêu cầu xác minh thêm...", không ở trạng thái connected                                                       | Not Run    |
| MX-04 | Nhận tin 1-1                                     | Dùng tài khoản Facebook khác nhắn tin Messenger riêng cho tài khoản đã kết nối                       | Hội thoại xuất hiện ở `/chat` kênh Messenger (trong vòng ~1 phút nếu dùng scheduler), tin hiện đúng nội dung, tăng chưa đọc       | Not Run    |
| MX-05 | Tin nhóm bị bỏ qua                               | Thêm tài khoản đã kết nối vào một nhóm Messenger, nhắn tin trong nhóm đó                             | Không có hội thoại/tin nào được tạo cho nhóm (BR-006, nhóm luôn off)                                                              | Not Run    |
| MX-06 | Tin tự gửi từ điện thoại bị bỏ qua               | Trên điện thoại/app Messenger khác, tự gửi tin từ chính tài khoản đã kết nối                         | Tin đó không xuất hiện trong `/chat` (tránh trùng với tin app tự gửi)                                                             | Not Run    |
| MX-07 | Trả lời và kiểm tra trên điện thoại              | Mở hội thoại Messenger trong `/chat`, gửi trả lời                                                    | Tin tới đúng người nhận, hiện trên Messenger thật của họ; trạng thái "đã gửi"                                                     | Not Run    |
| MX-08 | Mất mạng khi gửi                                 | Ngắt mạng tới homeserver ngay khi bấm gửi (hoặc dừng Synapse tạm thời)                               | Tin ở trạng thái "chưa chắc chắn" (`unknown`); bấm "Gửi lại" sau khi có mạng gửi lại được, không gửi trùng nếu homeserver đã nhận | Not Run    |
| MX-09 | Khởi động lại bridge/Synapse không trùng/mất tin | Dừng rồi chạy lại mautrix-meta và/hoặc Synapse trong lúc có tin mới đến; chạy lại `chat:matrix-sync` | Tin đến trong lúc gián đoạn vẫn được nhận đủ sau khi khởi động lại (bridge catchup), không có tin nào bị lặp                      | Not Run    |
| MX-10 | Đăng xuất phiên trên web                         | Đăng xuất Facebook trên trình duyệt đã lấy cookie, sau đó bấm "Kiểm tra kết nối"                     | Trạng thái chuyển `error`, thông báo "Phiên Facebook đã hết hạn hoặc bị chặn..."                                                  | Not Run    |
| MX-11 | Ngắt kết nối                                     | Bấm "Ngắt kết nối" ở `/integrations/messenger`                                                       | Trạng thái `disconnected`; hội thoại/tin cũ trong `/chat` vẫn còn nguyên, không bị xoá                                            | Not Run    |
| MX-12 | Grep log không có secret                         | Sau các bước trên, grep log Laravel và log bridge tìm giá trị cookie/token đã dùng                   | Không tìm thấy cookie, `MATRIX_ACCESS_TOKEN` hay `MAUTRIX_META_PROVISIONING_SECRET` trong bất kỳ log nào                          | Not Run    |
| MX-13 | Ảnh đến được lưu và hiển thị; media khác không làm vỡ luồng | Nhận một ảnh (có và không có chú thích), rồi video/voice/file từ người khác | Ảnh hiện trong thread (bấm mở tab mới), chú thích hiện dưới ảnh, preview "Đã gửi một ảnh"; ảnh tải lỗi/quá 10MB/không phải jpeg-png-gif-webp hiện "[Ảnh]" không file; video/voice/file hiện "Loại tin chưa hỗ trợ: ..."; mở trực tiếp URL ảnh khi chưa đăng nhập bị chuyển hướng đăng nhập | Not Run    |
| MX-15 | Tin cũ (backfill) được lưu | Bật backfill rồi đăng nhập/đồng bộ lại một chat có lịch sử | Khoảng 50 tin gần nhất của người khác hiện đúng thứ tự thời gian, `unread_count` không tăng vì tin cũ, tin cuối của danh sách vẫn là tin mới nhất, không có tin của chính bạn, chạy lại không trùng tin | Not Run    |
| MX-16 | Nhiều tài khoản Messenger | Ở `/integrations/messenger` đăng nhập tài khoản thứ hai bằng "Thêm tài khoản", nhận/gửi tin ở cả hai, rồi "Ngắt kết nối" một tài khoản | Hai thẻ profile (avatar, tên, trạng thái); tài khoản đầu không bị đăng xuất khi thêm tài khoản thứ hai; mỗi hội thoại gửi bằng đúng tài khoản của nó; ngắt một tài khoản không ảnh hưởng tài khoản còn lại và không xoá hội thoại/tin | Not Run    |
| MX-17 | Quyền theo từng tài khoản | Ở `/integrations/messenger` mở "Cài đặt" của tài khoản A, tắt "Nhận tin nhắn"; gửi/nhận tin ở A và ở tài khoản B | A không lưu tin mới đến, B vẫn nhận; tắt "Trả lời tin nhắn" của A thì không gửi được từ hội thoại của A nhưng B vẫn gửi được; "Gửi tin chủ động" tắt thì không mở được chat chưa có tin đến | Not Run    |
| MX-14 | Hồi quy Telegram/Zalo                            | Với Telegram/Zalo đã kết nối sẵn: nhận và gửi tin như cũ                                             | Hai kênh cũ vẫn hoạt động bình thường, không lẫn hội thoại với Messenger                                                          | Not Run    |
