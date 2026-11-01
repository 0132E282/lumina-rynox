# Testcase thủ công: đăng bài LinkedIn cá nhân bằng Chrome (không chính thức)

Cần tài khoản LinkedIn phụ thật, Google Chrome và Node trên máy chạy ứng dụng; chạy `pnpm install` và chạy migration `2026_10_31_000009` (sau khi sao lưu). Điều khoản LinkedIn hạn chế tự động hoá: tài khoản có thể bị hạn chế. Mọi selector trong `scripts/linkedin-post.mjs` (khối `LINKEDIN`) CHƯA từng kiểm với LinkedIn thật; ca nào Fail thì sửa khối đó.

Trạng thái: `Not Run` = chưa chạy. Chỉ đổi sang Pass/Fail sau khi thật sự chạy.

| ID | Tên | Các bước | Kết quả mong đợi | Trạng thái |
|---|---|---|---|---|
| LP-01 | Đăng nhập | `pnpm linkedin:login`, đăng nhập tay | Cửa sổ giữ nguyên đến khi có cookie `li_at`, rồi tự đóng | Not Run |
| LP-02 | Kiểm tra kết nối | Tích hợp > LinkedIn cá nhân > Lưu kết nối > Kiểm tra kết nối | Báo đã đăng nhập; chưa có mẫu request thì báo bài đầu đăng qua giao diện | Not Run |
| LP-03 | Bài văn bản đầu tiên, Mọi người | Tạo bài, chọn LinkedIn cá nhân, đối tượng Mọi người, đăng ngay | Đăng qua giao diện (`via ui`), bài hiện trên feed, có file `storage/app/linkedin-session.json` quyền 0600 | Not Run |
| LP-04 | Bài văn bản thứ hai (replay) | Đăng thêm một bài văn bản cùng đối tượng | `via browser-api`, bài lên feed, không đăng đôi | Not Run |
| LP-05 | Chỉ kết nối | Đăng bài với đối tượng Kết nối | Nhãn đối tượng được xác minh là "Chỉ kết nối" trước khi đăng; bài chỉ kết nối thấy | Not Run |
| LP-06 | Không đặt được đối tượng | Làm hỏng selector đối tượng (hoặc đổi ngôn ngữ giao diện lạ) | Lỗi `audience_not_set`, không có bài nào được đăng | Not Run |
| LP-07 | Ảnh | Đăng bài kèm 1 và 9 ảnh | Ảnh đính kèm đủ, bài lên; thư mục tạm `linkedin-post-*` bị xoá | Not Run |
| LP-08 | Video | Chọn video | Form từ chối trước khi đăng | Not Run |
| LP-09 | Chưa đăng nhập | Xoá hồ sơ `storage/app/linkedin-profile`, đăng bài | Lỗi nhắc chạy `pnpm linkedin:login` | Not Run |
| LP-10 | Checkpoint | Gặp màn hình xác minh | Script dừng báo `checkpoint`, không tự giải | Not Run |
| LP-11 | Mẫu cũ bị từ chối | Sửa tay `path` trong file phiên thành đường dẫn sai | Bị từ chối dứt khoát, rơi xuống giao diện đúng một lần và bắt lại mẫu | Not Run |
| LP-12 | Giới hạn giờ | Đặt `LINKEDIN_PERSONAL_POSTS_PER_HOUR=1`, đăng hai bài | Bài thứ hai báo đã đạt giới hạn, script không chạy | Not Run |
