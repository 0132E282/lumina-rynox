# Testcase thủ công: kênh Zalo đăng nhập QR

Cần tài khoản Zalo thật (nên dùng tài khoản phụ). Kết nối không chính thức, có rủi ro bị cảnh báo/khoá.

**Chuẩn bị:** đặt `ZALO_BRIDGE_SECRET` ngẫu nhiên trong `.env`; chạy `npm --prefix zalo-bridge install` rồi `npm --prefix zalo-bridge start`; chạy Laravel với nhiều worker (`PHP_CLI_SERVER_WORKERS=4 php artisan serve`); đã `php artisan migrate` và `permissions:generate` trên môi trường thử.

Trạng thái: `Not Run` = chưa chạy. Chỉ đổi sang Pass/Fail sau khi thật sự chạy.

| ID | Tên | Các bước | Kết quả mong đợi | Trạng thái |
|---|---|---|---|---|
| ZQ-01 | Quét QR thật | Vào `/integrations/zalo`, tick "Tôi hiểu rủi ro", bấm "Quét mã QR mới", quét bằng điện thoại và xác nhận | Hiện mã QR, sau xác nhận trang báo đã kết nối, hiện tên tài khoản | Not Run |
| ZQ-02 | Từ chối trên điện thoại | Quét QR rồi bấm từ chối/huỷ trên điện thoại | Trang báo bị từ chối, không ở trạng thái connected, có thể quét lại | Not Run |
| ZQ-03 | QR hết hạn | Hiện QR và không quét cho đến khi hết hạn | Trang báo mã hết hạn, cho phép tạo mã mới | Not Run |
| ZQ-04 | Nhận tin cá nhân | Dùng tài khoản khác nhắn tin riêng cho tài khoản đã kết nối | Hội thoại xuất hiện ở `/chat` kênh Zalo, tin hiện đúng, tăng chưa đọc, không trùng | Not Run |
| ZQ-05 | Nhận tin nhóm có mention | `group_mode = mention_only`; trong nhóm, mention tài khoản kết nối | Tin được đưa vào `/chat` | Not Run |
| ZQ-06 | Nhận tin nhóm không mention | `group_mode = mention_only`; gửi tin nhóm không mention. Lặp lại với `all` và `off` | `mention_only`: không nhận; `all`: nhận; `off`: không nhận | Not Run |
| ZQ-07 | Gửi tin | Mở hội thoại Zalo, nhập và gửi | Tin tới đúng người nhận trên Zalo, trạng thái "đã gửi"; bấm đúp không gửi hai lần | Not Run |
| ZQ-08 | Khởi động lại sidecar giữ phiên | Dừng rồi chạy lại `npm --prefix zalo-bridge start` khi đang connected | Không cần quét lại, nhận/gửi tin hoạt động lại | Not Run |
| ZQ-09 | Mở Zalo Web (displaced) | Đang connected, mở Zalo Web bằng cùng tài khoản | UI báo mất kết nối/bị đá, không báo connected giả; sau đó có thể quét lại | Not Run |
| ZQ-10 | Ngắt kết nối | Bấm "Ngắt kết nối" ở `/integrations/zalo` | Trạng thái disconnected, không nhận/gửi tin, sidecar không tự đăng nhập lại sau khi khởi động lại | Not Run |
| ZQ-11 | Telegram hồi quy | Với bot Telegram đã kết nối: nhận tin (`chat:telegram-poll`), gửi trả lời, kiểm tra kết nối | Telegram vẫn hoạt động như trước; hội thoại hai kênh không lẫn nhau | Not Run |
| ZQ-12 | Form Zalo cũ đang connected | Integration `zalo` cũ có `status = connected` từ trước (chưa có phiên QR): lưu lại form | Không tạo phiên; cần bấm "Ngắt kết nối" trước rồi quét QR mới kết nối được | Not Run |
| ZQ-13 | Đồng bộ danh bạ tự động | Quét QR mới thành công, mở `/chat` | Bạn bè và nhóm Zalo hiện ngay (kể cả chưa có tin), tên nhóm đúng, không có tin nhắn nào được tạo | Not Run |
| ZQ-14 | Đồng bộ danh bạ thủ công | Ở `/integrations/zalo` (đã đăng nhập) bấm "Đồng bộ danh bạ"; lặp lại ngay | Hiện số bạn bè/nhóm; lần lặp không tạo trùng; bấm quá 3 lần trong 10 phút báo giới hạn | Not Run |
| ZQ-15 | Đồng bộ khi bridge tắt/chưa đăng nhập | Tắt sidecar rồi bấm "Đồng bộ danh bạ" (và ở trạng thái session_lost) | Báo lỗi rõ ràng, không tạo hội thoại, nút dùng lại được | Not Run |
| ZQ-16 | Hội thoại danh bạ chưa có tin | Mở một bạn/nhóm chưa từng nhắn; thử gửi khi quyền "Gửi chủ động" tắt rồi bật | Khung chat rỗng mở được; tắt quyền thì hiện lý do "gửi chủ động đang tắt"; bật thì gửi được; tìm kiếm và lọc "Chưa đọc" đúng | Not Run |
| ZQ-17 | Tên nhóm và danh bạ lớn | Tài khoản có nhiều nhóm (>50) | Mọi nhóm có tên, đồng bộ xong không bị Zalo cảnh báo; danh bạ quá lớn báo "chỉ lấy một phần" | Not Run |
| ZQ-18 | Thêm tài khoản thứ hai | Ở `/integrations/zalo` (đã có một tài khoản đang chạy) bấm "Thêm tài khoản", tick "Tôi hiểu rủi ro", chọn quyền, bấm "Quét mã QR" và quét bằng Zalo thứ hai | Bảng có 2 dòng đang kết nối; tài khoản đầu không bị đăng xuất; quyền đã chọn áp dụng cho tài khoản mới | Not Run |
| ZQ-19 | Hai tài khoản nhận tin cùng lúc | Hai tài khoản cùng nhận tin; thử cùng một người bạn nhắn cho cả hai | `/chat` có hai hội thoại riêng (mỗi tài khoản một hội thoại), chip tên tài khoản hiện khi có hơn 1 tài khoản, tin không lẫn nhau | Not Run |
| ZQ-20 | Gửi đúng tài khoản | Mở hội thoại của tài khoản B và gửi tin | Tin tới từ đúng tài khoản B trên Zalo; nhãn tin của ta ở `/chat` là tên tài khoản B | Not Run |
| ZQ-21 | Quyền theo tài khoản | Bấm "Cài đặt" ở tài khoản A tắt "Trả lời tin nhắn"; thử gửi ở hội thoại A và B | Hội thoại A báo quyền tắt; hội thoại B vẫn gửi được; "Cài đặt" lưu cả "Chế độ nhóm" riêng từng tài khoản | Not Run |
| ZQ-22 | Ngắt một tài khoản | Bấm "Ngắt kết nối" (xác nhận) ở tài khoản A | A thành "Đã ngắt kết nối", B vẫn nhận/gửi; hội thoại và tin của A vẫn còn; sidecar không tự đăng nhập lại A sau khi khởi động lại | Not Run |
| ZQ-23 | Khởi động lại sidecar với nhiều tài khoản | Dừng rồi chạy lại `npm --prefix zalo-bridge start` khi có 2 tài khoản | Cả hai tự đăng nhập lại không cần quét, lần lượt cách nhau vài giây; không bị Zalo cảnh báo | Not Run |
| ZQ-24 | Đồng bộ danh bạ theo tài khoản | Bấm "Đồng bộ danh bạ" ở dòng tài khoản A | Chỉ danh bạ của A được thêm vào `/chat` (gắn A); B không đổi; quá 3 lần trong 10 phút báo giới hạn | Not Run |
| ZQ-25 | Migration `zalo_accounts` trên dữ liệu thật | Sau khi người dùng đồng ý chạy `php artisan migrate`: kiểm tra `/integrations/zalo` và `/chat` | Phiên Zalo cũ thành tài khoản đầu tiên (giữ quyền và chế độ nhóm), mọi hội thoại Zalo cũ gắn tài khoản đó, vẫn nhận/gửi được không cần quét lại | Not Run |
