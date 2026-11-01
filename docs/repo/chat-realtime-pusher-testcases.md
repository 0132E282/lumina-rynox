# Testcase thủ công: /chat realtime qua Pusher Channels

Cần app Pusher Channels do người dùng tự tạo (chọn cluster), điền `BROADCAST_CONNECTION=pusher`, `PUSHER_APP_ID`, `PUSHER_APP_KEY`, `PUSHER_APP_SECRET`, `PUSHER_APP_CLUSTER` vào `.env`, xoá cache cấu hình rồi `pnpm run build` (các biến `VITE_PUSHER_*` được nhúng lúc build). Hạn mức gói Pusher: xem trang pricing của Pusher trước khi dùng.

Trạng thái: `Not Run` = chưa chạy. Chỉ đổi sang Pass/Fail sau khi thật sự chạy.

| ID | Tên | Các bước | Kết quả mong đợi | Trạng thái |
|---|---|---|---|---|
| RT-01 | Tin Telegram mới | Mở `/chat` ở tab A, gửi tin vào bot Telegram (poller đang chạy) | Tab A hiện tin trong khoảng 1-2 giây; chỉ báo "Trực tiếp"; Network không có request poll định kỳ | Not Run |
| RT-02 | Tin Zalo mới | Như RT-01 với tài khoản Zalo đã kết nối | Tab A hiện tin trong khoảng 1-2 giây | Not Run |
| RT-03 | Trạng thái gửi | Gửi tin từ `/chat`; làm một tin ở trạng thái unknown/failed rồi "Gửi lại" | Trạng thái tin cập nhật ở tab khác mà không chờ poll | Not Run |
| RT-04 | Đọc ở tab khác | Mở cùng hội thoại chưa đọc ở tab B | Badge chưa đọc ở tab A giảm về 0 | Not Run |
| RT-05 | Kênh mất kết nối | Làm Telegram/Zalo chuyển `error` hoặc `disconnected` | Banner "Mất kết nối" hiện ở tab đang mở | Not Run |
| RT-06 | Gộp sự kiện | Gửi nhiều tin liên tiếp trong khoảng 300 ms | Chỉ một request reload (`only` LIVE_PROPS) trong Network | Not Run |
| RT-07 | Pusher ngắt | DevTools chuyển Offline rồi bật lại | Chỉ báo "Đang kết nối lại, cập nhật mỗi 30 giây" và poll 30 giây/lần; nối lại thì "Trực tiếp", reload một lần, ngừng poll | Not Run |
| RT-08 | Key sai | Đặt `VITE_PUSHER_APP_KEY` sai rồi build lại | Chỉ báo "Không kết nối được realtime, cập nhật mỗi 30 giây"; poll 30 giây | Not Run |
| RT-09 | Tab ẩn | Chuyển sang tab khác, gửi tin vào, quay lại | Không có request khi ẩn; hiện lại thì đúng một reload | Not Run |
| RT-10 | Đang gửi tin | Có sự kiện đến đúng lúc bấm Gửi | Không reload chen giữa; xong thì reload một lần | Not Run |
| RT-11 | Chưa cấu hình | Bỏ `VITE_PUSHER_APP_KEY`, build lại | Không kết nối Pusher, không gọi `/broadcasting/auth`, poll 5 giây, không có chỉ báo | Not Run |
| RT-12 | Phân quyền | Đăng nhập admin không có `conversations.view` hoặc chưa đăng nhập, gọi `POST /broadcasting/auth` với `private-chat` | Bị từ chối (403) | Not Run |
| RT-13 | Nội dung payload | Gửi tin có nội dung riêng, xem Debug Console của Pusher | Payload chỉ có `kinds` và `conversation_ids`, không có nội dung/tên người | Not Run |
| RT-14 | Pusher lỗi phía server | Đặt `PUSHER_APP_SECRET` sai, nhận một tin Telegram/Zalo | Tin vẫn được lưu và ack; log có đúng câu "Chat realtime broadcast failed."; 60 giây sau mới thử lại | Not Run |
| RT-15 | Tắt realtime | `BROADCAST_CONNECTION=null`, bỏ `VITE_PUSHER_APP_KEY`, build lại | `/chat` về poll 5 giây như cũ | Not Run |
