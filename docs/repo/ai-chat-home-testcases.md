# Testcase thủ công: Chat AI ở trang chủ

Cần DB đã `php artisan migrate` (bảng `ai_conversations`, `ai_messages`, migration `2026_11_01_000001_create_ai_chat_tables.php`), ít nhất một tài khoản AI bật cho mục đích "Hỏi đáp" và quyền `ai.use`. Test tự động ở `tests/Feature/AiChat`.

Trạng thái: `Not Run` = chưa chạy. Chỉ đổi sang Pass/Fail sau khi thật sự chạy.

| ID | Tên | Các bước | Kết quả mong đợi | Trạng thái |
|---|---|---|---|---|
| AICHAT-01 | Trạng thái trống | Mở `/` | Lời chào "Hôm nay bạn muốn làm gì?", ô soạn ở giữa, cột "Gần đây" bên trái | Not Run |
| AICHAT-02 | Gửi tin đầu tiên | Gõ câu hỏi, Enter | Bong bóng người dùng bên phải, vòng quay chờ, câu trả lời bên trái, ô soạn xuống đáy, URL thành `/?c=<id>`, cuộc trò chuyện hiện ở "Gần đây" với tiêu đề cắt từ tin đầu | Not Run |
| AICHAT-03 | Enter / Shift+Enter | Shift+Enter, rồi Enter | Shift+Enter xuống dòng, Enter gửi; ô soạn bị khoá khi đang gửi | Not Run |
| AICHAT-04 | Cuộc trò chuyện mới | Bấm "Cuộc trò chuyện mới" | Về trạng thái trống; cuộc cũ vẫn ở "Gần đây" | Not Run |
| AICHAT-05 | Mở lại cuộc cũ | Bấm một mục "Gần đây", gửi thêm một tin | Lịch sử hiện đủ, câu trả lời mới dựa trên ngữ cảnh trước | Not Run |
| AICHAT-06 | Chưa cấu hình AI | Tắt mọi tài khoản AI, gửi tin | Dòng lỗi "Chưa cấu hình trợ lý AI." trong luồng; tải lại thì không có tin nào được lưu | Not Run |
| AICHAT-07 | Riêng tư | Đăng nhập admin khác, mở `/?c=<id của admin kia>` | 404, danh sách "Gần đây" không có cuộc của người khác | Not Run |
| AICHAT-08 | Phân quyền | Admin không có `ai.use` mở `/` | Chuyển sang `/dashboard`; `POST /ai-chat/messages` trả 403 | Not Run |
| AICHAT-09 | Dashboard | Menu "Tổng quan" > Dashboard | Mở `/dashboard` như trước | Not Run |
| AICHAT-10 | Giao diện | Sáng/tối, màn hình hẹp | Theo theme; màn hình hẹp mở "Gần đây" bằng nút menu | Not Run |
