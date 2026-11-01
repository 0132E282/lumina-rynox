# Testcase thủ công: crawl việc làm công khai (TopCV/ITviec)

Cần mạng thật và DB đã `php artisan migrate`, `php artisan permissions:generate`. Test tự động (Http::fake) đã có ở `tests/Feature/Jobs`; file này chỉ gồm kiểm thử với site thật.

Trạng thái: `Not Run` = chưa chạy. Chỉ đổi sang Pass/Fail sau khi thật sự chạy.

| ID | Tên | Các bước | Kết quả mong đợi | Trạng thái |
|---|---|---|---|---|
| JB-01 | Lưu tiêu chí | Ở `/integrations/itviec` nhập "Backend · PHP/Laravel · từ 35 triệu", lưu | Trang `/jobs` hiện tiêu chí ở thẻ "Tự lọc việc làm phù hợp" | Not Run |
| JB-02 | Tìm việc ngay | Ở `/jobs` bấm "Tìm việc ngay" | Toast "Đã đọc N việc làm", bảng có việc ITviec, trạng thái "Lần đọc gần nhất thành công" | Not Run |
| JB-03 | Chạy lại | Bấm lại hoặc chạy `php artisan jobs:crawl itviec` | Không có dòng trùng; `last_seen_at` đổi, `first_seen_at` giữ nguyên | Not Run |
| JB-04 | Lọc và phân trang | Chọn tab ITviec, gõ từ khoá, sang trang 2 | Danh sách lọc đúng, giữ filter khi đổi trang | Not Run |
| JB-05 | Throttle | Bấm "Tìm việc ngay" lần thứ 4 trong 10 phút | HTTP 429, không có request mới tới site | Not Run |
| JB-06 | TopCV bị chặn | Bật lại `active` của topcv (thử nghiệm), chạy `php artisan jobs:crawl topcv` | Trạng thái `blocked`, không lưu việc, lần chạy kế tiếp bị `skipped` tới hết 24 giờ | Not Run |
| JB-07 | Scheduler | `php artisan schedule:list` | Có `jobs:crawl` mỗi 4 giờ | Not Run |
| JB-08 | Phân quyền | Admin chỉ có `jobs.view` mở `/jobs` và bấm tìm | Xem được danh sách, không thấy nút "Tìm việc ngay", `POST /jobs/crawl` trả 403 | Not Run |
