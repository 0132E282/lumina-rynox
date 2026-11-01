# Testcase thủ công: đăng nhập LinkedIn cá nhân (OAuth)

Cần tài khoản LinkedIn thật và một ứng dụng tại LinkedIn Developers (sản phẩm "Share on LinkedIn" và "Sign In with LinkedIn using OpenID Connect", Redirect URI = `APP_URL/integrations/linkedin/oauth/callback`). Đặt `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET` trong `.env`, xoá cache cấu hình. Endpoint/scope trong `config/services.php` chưa được đối chiếu với tài liệu LinkedIn hiện hành.

Trạng thái: `Not Run` = chưa chạy. Chỉ đổi sang Pass/Fail sau khi thật sự chạy.

| ID | Tên | Các bước | Kết quả mong đợi | Trạng thái |
|---|---|---|---|---|
| LI-01 | Tạo app LinkedIn | Tạo app, thêm 2 sản phẩm, thêm Redirect URI, lấy Client ID/Secret | Tab Auth hiện đủ scope `openid`, `profile`, `w_member_social` | Not Run |
| LI-02 | Chưa cấu hình | Để trống `LINKEDIN_CLIENT_ID`, mở `/integrations/linkedin` | Nút "Đăng nhập với LinkedIn" bị khoá kèm hướng dẫn đặt env | Not Run |
| LI-03 | Đăng nhập thật | Bấm "Đăng nhập với LinkedIn", đồng ý quyền | Quay về `/integrations/linkedin` với thông báo thành công; hiện tên tài khoản và ngày hết hạn; URL không còn `code`/`state` | Not Run |
| LI-04 | Từ chối quyền | Bấm Cancel ở màn hình LinkedIn | Quay về trang với thông báo huỷ, không có kết nối mới | Not Run |
| LI-05 | Đăng 1 bài | Tạo bài, chọn LinkedIn, đăng ngay | Bài xuất hiện trên trang cá nhân LinkedIn, target `published` | Not Run |
| LI-06 | Hẹn giờ đăng | Hẹn giờ 1 bài LinkedIn | Bài được đăng đúng giờ | Not Run |
| LI-07 | Token hết hạn | Sửa `meta.expires_at` về quá khứ (môi trường thử) hoặc chờ hết hạn | Trang hiện "Hết hạn" và cảnh báo đăng nhập lại; đăng lại thì hết cảnh báo | Not Run |
| LI-08 | Sắp hết hạn | Đặt `expires_at` còn < 7 ngày | Hiện cảnh báo "sắp hết hạn" | Not Run |
| LI-09 | Ngắt kết nối | Bấm "Ngắt kết nối" | Trạng thái "Chưa kết nối", token bị xoá | Not Run |
| LI-10 | Token thủ công | Mở mục "Dán token thủ công", dán token và Author URN rồi lưu | Lưu được; hạn token hiển thị "Dán thủ công, không rõ hạn" | Not Run |
