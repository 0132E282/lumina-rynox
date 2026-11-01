# Testcase thủ công: Hộp thư chung (`/inbox`)

Cần trình duyệt, DB đã có hội thoại chat (Telegram/Zalo/Messenger) và thư INBOX. Test tự động ở `tests/Feature/Inbox/InboxTest.php` chỉ kiểm backend (lọc, thứ tự, phân quyền, số truy vấn); giao diện chưa được chạy trên trình duyệt.

Trạng thái: `Not Run` = chưa chạy. Chỉ đổi sang Pass/Fail sau khi thật sự chạy.

| ID | Tên | Các bước | Kết quả mong đợi | Trạng thái |
|---|---|---|---|---|
| IB-01 | Sidebar | Mở nhóm "Giao tiếp" | Có "Hộp thư chung" (badge = chưa đọc chat + email) và "Tài khoản email" (`/mail/accounts`); `/chat` và `/mail` vẫn mở được | Not Run |
| IB-02 | Danh sách gộp | Mở `/inbox` | Chat và email xen kẽ theo thời gian mới nhất trước; mỗi dòng có avatar + huy hiệu kênh, tên, tin cuối, giờ | Not Run |
| IB-03 | Lọc kênh | Bấm lần lượt Tất cả, Email, Zalo, Zalo nhóm, Facebook, Telegram | Danh sách chỉ còn đúng kênh; nhóm Zalo chỉ ở "Zalo nhóm"; giữ ô tìm kiếm và "Chưa đọc" | Not Run |
| IB-04 | Chưa đọc và tìm | Bấm "Chưa đọc"; gõ tên khách hoặc người gửi/tiêu đề thư | Chỉ còn chat có `unread_count > 0` và thư chưa xem; tìm ra cả chat lẫn email | Not Run |
| IB-05 | Mở chat | Bấm một hội thoại | Khung phải hiện tin nhắn, ô soạn, panel thông tin; số chưa đọc về 0; gửi tin hoạt động như `/chat` | Not Run |
| IB-06 | Mở email | Bấm một thư | Khung phải hiện cả luồng thư, thư được đánh dấu đã xem, trả lời xong vẫn ở `/inbox?m=` và hiện toast; "Đánh dấu chưa đọc" quay về `/inbox` | Not Run |
| IB-07 | Phân quyền | Đăng nhập admin chỉ có `conversations.view`, rồi chỉ có `mail.view` | Mỗi người chỉ thấy tab và dòng của kênh mình được xem; không có quyền nào thì 403 | Not Run |
| IB-08 | Realtime và poll | Có tin Telegram/Zalo mới và thư mới | Chat cập nhật theo realtime/poll như `/chat`; email xuất hiện trong tối đa 60 giây | Not Run |
| IB-09 | Phân trang | Có hơn 30 mục | Chân danh sách hiện "Trang x/y", chuyển trang giữ bộ lọc | Not Run |
| IB-10 | Di động | Thu hẹp dưới 1024px | Chỉ hiện danh sách; mở mục thì hiện khung phải với nút quay lại | Not Run |
