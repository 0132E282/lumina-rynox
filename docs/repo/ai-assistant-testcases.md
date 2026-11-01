# Testcase thủ công: Trợ lý AI (nhiều tài khoản, nháp trả lời, báo cáo, thanh bên phải)

Cần tài khoản/API token thật, DB đã `php artisan migrate` (bảng `ai_accounts`, migration `2026_10_31_000007_create_ai_accounts_table.php`) và `php artisan permissions:generate` (quyền `ai.use`). Test tự động (Http::fake, Process::fake) ở `tests/Feature/Ai`.

Trạng thái: `Not Run` = chưa chạy. Chỉ đổi sang Pass/Fail sau khi thật sự chạy.

| ID | Tên | Các bước | Kết quả mong đợi | Trạng thái |
|---|---|---|---|---|
| AI-01 | Thêm tài khoản API | `/integrations/ai` > Thêm tài khoản, chọn nhà cung cấp, loại API token, dán token, Lưu | Dòng mới trong bảng, token chỉ hiện 4 ký tự cuối | Not Run |
| AI-02 | Kiểm tra từng tài khoản | Bấm "Kiểm tra" | Toast thành công hoặc lỗi cố định; trạng thái dòng cập nhật | Not Run |
| AI-03 | Session token (CLI) | Thêm tài khoản loại Session token cho Claude/Codex/Gemini, bấm Kiểm tra | CLI chạy trên máy chủ và trả lời; sai/thiếu CLI thì báo "Không chạy được CLI AI" | Not Run |
| AI-04 | Dự phòng theo ưu tiên | Hai tài khoản, tài khoản ưu tiên nhỏ dùng token sai, bấm "Gợi ý AI" | Vẫn có nháp từ tài khoản thứ hai; tài khoản đầu hiện lỗi | Not Run |
| AI-05 | Gợi ý AI trong chat | Mở hội thoại có tin, bấm "Gợi ý AI" | Ô soạn được điền nháp; không có tin mới nào được gửi/lưu cho tới khi bấm Gửi | Not Run |
| AI-06 | Thanh AI bên phải | Bấm "Trợ lý AI" ở header, hỏi một câu, bấm "Báo cáo hôm nay" | Panel bên phải mở/đóng (trang chat đầy đủ nằm ở mục "Trợ lý AI" trỏ tới `/`) | Not Run |
| AI-07 | Viết bài nháp | `/posts/create`, nhập ý tưởng, bấm "Gợi ý AI" | Nội dung bài được điền; chưa lưu/đăng | Not Run |
| AI-08 | Báo cáo 08:00 | Đặt "Hội thoại nhận báo cáo", chạy `php artisan ai:send-report` | Tin báo cáo của hôm qua vào đúng hội thoại; chạy lại cùng ngày không gửi đôi | Not Run |
| AI-09 | Phân quyền | Admin không có `ai.use` | Không thấy nút Trợ lý AI; `POST /ai/ask` trả 403 | Not Run |
