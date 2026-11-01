# Testcase thủ công: Email (nhiều hộp thư IMAP/SMTP)

Cần hộp thư thật, DB đã `php artisan migrate` và `php artisan permissions:generate`, scheduler đang chạy (`php artisan schedule:work`). Test tự động (fake IMAP/SMTP) đã có ở `tests/Feature/Mail`, `tests/Unit/Mail`; file này chỉ gồm kiểm thử cần máy chủ thật.

Trạng thái: `Not Run` = chưa chạy. Chỉ đổi sang Pass/Fail sau khi thật sự chạy.

| ID | Tên | Các bước | Kết quả mong đợi | Trạng thái |
|---|---|---|---|---|
| EM-01 | Gmail mật khẩu ứng dụng | `/mail/accounts` > Thêm hộp thư > Gmail, nhập địa chỉ và mật khẩu ứng dụng, bấm Kiểm tra kết nối rồi Lưu | Kiểm tra báo IMAP và SMTP thành công; hộp thư "Đã kết nối" | Not Run |
| EM-02 | IMAP host riêng 993 | Chọn IMAP khác, nhập `host:993` và `host:587` hoặc `host:465` | Kiểm tra và đồng bộ thành công | Not Run |
| EM-03 | IMAP host riêng 143 STARTTLS | Nhập `host:143` | Kết nối bằng STARTTLS; máy chủ không hỗ trợ STARTTLS thì báo "không hỗ trợ kết nối mã hoá", không hạ xuống plain text | Not Run |
| EM-04 | Outlook | Chọn Outlook, nhập mật khẩu ứng dụng | Có thể lỗi "Sai tài khoản hoặc mật khẩu" nếu Microsoft yêu cầu OAuth; trang có cảnh báo; không bị khoá đăng nhập liên tục | Not Run |
| EM-05 | Đồng bộ lần đầu | Lưu hộp thư có nhiều thư | Chỉ lấy thư trong `MAIL_CLIENT_INITIAL_DAYS` ngày, tối đa `MAIL_CLIENT_INITIAL_LIMIT`; INBOX và Đã gửi hiện ở `/mail`; badge Email ở sidebar đúng số chưa đọc | Not Run |
| EM-06 | Thư mới theo chu kỳ | Gửi thư tới hộp thư từ nơi khác, chờ 1-5 phút theo tần suất | Thư xuất hiện ở `/mail` sau lần đồng bộ kế tiếp (tự làm mới 60 giây) | Not Run |
| EM-07 | Thư HTML và ảnh theo dõi | Mở thư HTML có tracking pixel, mở DevTools > Network | Hiển thị trong iframe; không có request ảnh từ xa trước khi bấm "Hiện ảnh"; sau khi bấm ảnh tải; không script nào chạy | Not Run |
| EM-08 | Đính kèm | Mở thư có tệp đính kèm | Chỉ liệt kê tên, dung lượng; không có liên kết tải | Not Run |
| EM-09 | Đánh dấu đọc thấy trên webmail | Mở thư chưa đọc rồi bấm Đánh dấu chưa đọc ở một thư khác; xem webmail | Cờ đã đọc/chưa đọc khớp trên webmail; thư mở trong app thành đã đọc | Not Run |
| EM-10 | Trả lời giữ luồng | Trả lời một thư | Thư tới người nhận, đúng From, trong webmail nằm cùng luồng (In-Reply-To/References); thư gốc có dấu đã trả lời | Not Run |
| EM-11 | Bản sao Đã gửi | Gmail (không bật lưu bản sao) và host khác (bật lưu bản sao): trả lời | Gmail chỉ có một bản trong Đã gửi; host khác có đúng một bản do app APPEND; lỗi APPEND chỉ hiện "chưa lưu được bản sao" | Not Run |
| EM-12 | Không gửi đúp | Bấm Gửi hai lần nhanh | Người nhận chỉ nhận một thư | Not Run |
| EM-13 | Timeout khi gửi | Cắt mạng giữa lúc gửi | Trạng thái "Chưa chắc chắn"; Gửi lại hỏi xác nhận "Có thể gửi trùng"; không tự gửi lại | Not Run |
| EM-14 | Sai mật khẩu dừng đồng bộ | Đổi mật khẩu ứng dụng trên nhà cung cấp, chờ đồng bộ | Hộp thư chuyển "Lỗi kết nối", không thử lại tới khi bấm Thử lại hoặc lưu mật khẩu mới | Not Run |
| EM-15 | Host nội bộ bị chặn | Nhập `127.0.0.1:993` hoặc host phân giải ra IP nội bộ | Lỗi "Máy chủ này không được phép kết nối", không lưu | Not Run |
| EM-16 | Xoá hộp thư | Xoá hộp thư ở `/mail/accounts` | Thư trong app biến mất; thư trên webmail vẫn còn nguyên | Not Run |
| EM-17 | Phân quyền | Admin chỉ có `mail.view`; admin có `mail.send` nhưng không `integrations.update` | Chỉ-xem không thấy ô trả lời, gửi bị 403; không vào được thêm/sửa hộp thư | Not Run |
| EM-18 | Cấu hình Email cũ | Có Integration email cũ có mật khẩu, mở `/mail/accounts` | Có thông báo cấu hình cũ và nút xoá; xoá xong thông báo biến mất | Not Run |
| EM-19 | Giao diện so với mockup | So `/mail`, `/mail/accounts/create` với `docs/design/mockups/email-list-desktop.png`, `email-form-desktop.png` | Bố cục khớp (trừ cột Nhãn, thẻ Cần trả lời/Đã gắn nhãn đã bỏ có chủ đích) | Not Run |
