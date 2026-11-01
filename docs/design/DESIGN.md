---
name: Personal Manager (trên Lumina CMS)
description: Đặc tả UX/UI các module cá nhân (hiện chỉ còn Công việc; Chi tiêu, Thói quen, Ghi chú đã bỏ ngày 2026-10-27, D15) bám giao diện admin Lumina CMS hiện có; không tạo design system mới.
colors:
  background: "#FAFAFA"
  foreground: "#18181B"
  card: "#FFFFFF"
  primary: "#2F6FED"
  primary-foreground: "#FFFFFF"
  muted: "#F4F4F5"
  muted-foreground: "#71717A"
  accent: "#EFF4FE"
  destructive: "#E5484D"
  border: "#E4E4E7"
  input: "#D4D4D8"
  ring: "#2F6FED"
typography:
  body:
    fontFamily: Instrument Sans
    fontSize: 14px
rounded:
  default: 4px
spacing:
  unit: 4px
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    rounded: "{rounded.default}"
    height: 36px
  card:
    backgroundColor: "{colors.card}"
    rounded: "{rounded.default}"
---

# Đặc tả UX/UI: Personal Manager trên Lumina CMS

Trạng thái: đặc tả, chưa có code. Chưa chạy `npm run design:lint` (chưa có công cụ trong project này). Token trong front matter được sao từ `lumina-cms/resources/css/app.css` (chế độ sáng), không phải giá trị mới.

## 0. Nguồn chuẩn, phạm vi, giả định

Nguồn chuẩn (đã đọc): `lumina-cms/README.md`, `AGENT.md`, `docs/ux-ui-design.md`, `config/views.php`, `resources/css/app.css`, và trong `resources/js/`: `layouts/` (`app-layout`, `index-layout`, `form-layout`), `components/ui/*`, `components/tables/*`, `components/form/*`, `components/toolbar/*`, `components/confirm-dialog.tsx`, `pages/dashboard.tsx`, `pages/roles/index.tsx`, `pages/admins/*`. Chưa chạy ứng dụng nên chưa đối chiếu ảnh chụp thật; các mô tả dựa trên code.

Dữ kiện đã chốt: Laravel 13 + React 19 + Inertia 3 (nền Lumina CMS); dữ liệu lưu MySQL (cấu hình `.env`, README mặc định là SQLite); 4 module; Lark chỉ cho Công việc, UI chỉ có badge trạng thái đồng bộ + nút đồng bộ lại; một người dùng (chủ sở hữu, dùng tài khoản admin của CMS).

Nguyên tắc: UI hiện có là chuẩn. Dùng lại sidebar, header, `IndexLayout`/`DataTable`, `FormLayout`/`Field`, `Card`, `Badge`, `useConfirm`, `sonner` toast. Không đổi theme, font, bán kính, màu. Tính năng trong CMS không thuộc 4 module (Admin, Vai trò, File Manager, Activity log, Cài đặt, API keys, import/export) giữ nguyên, không thiết kế lại và không đưa vào các module mới.

Giả định: tiếng Việt như CMS; VND; mỗi module là một resource kiểu CMS (model trong `App\Models`, trang index + form qua `IndexLayout`/`FormLayout`); dark mode do CMS sẵn có (`use-appearance`) nên được kế thừa, không thiết kế thêm.

> **Đã bỏ ngày 2026-10-27 (quyết định D15):** các module Chi tiêu (/expenses), Thói quen (/habits) và Ghi chú (/notes), cùng nhóm sidebar "Cá nhân" và thẻ dashboard tương ứng, đã bị gỡ khỏi code. Các mục đánh dấu "(ĐÃ BỎ)" dưới đây chỉ giữ làm tham khảo lịch sử; chỉ Công việc còn hiệu lực.

## 1. Điều hướng

Thêm 4 mục vào `config/views.php` > `sidebar.main` (nguồn duy nhất của sidebar), dưới "Dashboard":

| Mục | URL | Icon lucide gợi ý (qua `lib/icon-map.ts`) |
|---|---|---|
| Công việc | /tasks | ListChecks (hoặc CheckSquare) |
| ~~Chi tiêu~~ (ĐÃ BỎ) | /expenses | Wallet |
| ~~Thói quen~~ (ĐÃ BỎ) | /habits | Repeat (hoặc Flame) |
| ~~Ghi chú~~ (ĐÃ BỎ) | /notes | StickyNote |

Ghi chú: tên URL/resource là đề xuất theo quy ước `ResourceResolver` (slug số nhiều của model); coder chốt theo model thực tế. Nếu icon chưa có trong `icon-map.ts` thì thêm theo cách bảng này đang làm (ngoài phạm vi thiết kế).

Hành vi kế thừa nguyên: sidebar rộng 240px, thu về icon hoặc offcanvas trên mobile (`use-mobile`), ô tìm menu, `aria-current`, skip link, breadcrumb và header sticky (`site-header`). Không dùng tab dưới hay thanh điều hướng riêng.

## 2. Bảng ánh xạ trang và component CMS

| Trang | Layout/component CMS dùng lại | Phần mới phải làm (nhỏ) |
|---|---|---|
| Dashboard `/` | `pages/dashboard.tsx` (`Card`, `CardHeader/Content`, `Skeleton`, `Deferred`, lưới card) và `StatusSummaryCards` | Thêm khối 4 card module; giữ hay bỏ card tình trạng CMS/Analytics: xem câu hỏi 1 |
| Công việc, danh sách | `IndexLayout` + `DataTable` (search, filter popover, sort, phân trang, chọn nhiều, xoá nhiều), `createColumns`/`createSelectColumn`/`createBadgeColumn`/`createActionsColumn`, `Badge`, `useConfirm` | Cột badge Lark; nút "Đồng bộ lại" trong cột thao tác; ô thêm nhanh |
| Công việc, thêm/sửa | `FormLayout` + `Section` + `Field` (`ui="input"`, `textarea`, `select`, `switch`), `FormToolbar` | Không |
| Chi tiêu, danh sách | `IndexLayout` + `DataTable`, `createPriceColumn`, `createBadgeColumn` (danh mục), `renderAbove` của `IndexLayout`, `StatusSummaryCards`/`DashboardCards` cho tổng hợp, `Select` chọn tháng | Khối tổng hợp tháng + bộ chọn tháng |
| Chi tiêu, thêm/sửa | `FormLayout` + `Field` (input number, select, input date, textarea) | Không |
| Thói quen, danh sách | `Card` mỗi thói quen hoặc `SimpleTable` (`tables/simple-table`), `Checkbox`/`Toggle`, `Badge`, `Dialog` để thêm/sửa tên, `useConfirm` | Lưới 7 ngày đánh dấu + hiển thị chuỗi (component mới duy nhất đáng kể) |
| Ghi chú, danh sách | `IndexLayout` + `DataTable` (ô tìm server-side `onSearchChange`), `Pagination` | Đánh dấu từ khoá trong tiêu đề/đoạn trích (thẻ `mark`) |
| Ghi chú, thêm/sửa | `FormLayout` + `Field` `ui="input"` (tiêu đề) và `ui="textarea"` (nội dung) | Không (xem câu hỏi 5 về `editor`) |
| Đăng nhập | Trang auth sẵn có của CMS (Fortify, `auth-layout`) | Không |

Quy ước chung của các trang danh sách: dùng `PageConfig` (`title`, `columns`, `collection`, `searchPlaceholder`, `defaultSort`, `actions: {create, delete, search}`). Tắt `import`/`export`/`trash` (không thuộc yêu cầu). Trạng thái rỗng dùng `emptyMessage` của `DataTable`.

## 3. Luồng thao tác và số bước

Bước = số click/chạm có chủ đích từ trang module, không tính gõ chữ.

### 3.1 Công việc (/tasks)

| Tác vụ | Luồng | Bước |
|---|---|---|
| Thêm nhanh | Gõ tiêu đề vào ô thêm nhanh phía trên bảng, Enter | 1 |
| Thêm đầy đủ | Nút "Thêm mới" (toolbar sẵn có), `FormLayout`, Lưu | 2 |
| Hoàn thành | Click checkbox/badge trạng thái ở dòng | 1 |
| Sửa | Click tiêu đề (cột link), form, Lưu | 2 |
| Xoá | Menu thao tác của dòng, Xoá, xác nhận `useConfirm` | 3 (xoá nhiều: chọn, Xoá, xác nhận) |
| Lọc | Popover bộ lọc của `DataTable` (trạng thái, ưu tiên, hạn) | 2-3 |
| Tìm | Ô tìm của toolbar (tiêu đề/mô tả) | 1 |
| Đồng bộ lại Lark | Nút "Đồng bộ lại" ở dòng task lỗi/chưa đồng bộ | 1 |

Trường: Tiêu đề (bắt buộc, `validate="min:1:..."`), Mô tả, Hạn (ngày), Ưu tiên (Thấp/Vừa/Cao), Trạng thái (Chưa xong/Đã xong).

Badge Lark (dùng `Badge`, luôn có chữ + icon, không chỉ màu):
- "Chưa đồng bộ": variant `outline`, icon CloudOff hoặc Circle.
- "Đã đồng bộ": variant `secondary` kèm icon Check; có thể dùng `createBadgeColumn` với `BadgeColor`.
- "Lỗi đồng bộ": variant `destructive`, icon AlertCircle; lý do ngắn trong `Tooltip` và trong form sửa task (dòng `description` dưới badge); kèm nút `Button size="xs"` "Đồng bộ lại".
- Đang đồng bộ: nút `disabled` + `Spinner`, chữ "Đang đồng bộ…".
Lưu task vẫn thành công khi Lark lỗi; kết quả đồng bộ báo bằng toast (`sonner`, qua `use-flash-toast`) và badge.

### 3.2 Chi tiêu (/expenses) (ĐÃ BỎ)

| Tác vụ | Luồng | Bước |
|---|---|---|
| Thêm | "Thêm mới", `FormLayout` (số tiền, danh mục, ngày mặc định hôm nay, ghi chú), Lưu | 2 |
| Sửa / Xoá | Như Công việc | 2 / 3 |
| Lọc | Chọn tháng (mặc định tháng hiện tại, nút trước/sau) ở khối tổng hợp; danh mục qua popover lọc | 1 / 2-3 |
| Tìm | Ô tìm theo ghi chú | 1 |
| Tổng hợp tháng | Có sẵn đầu trang | 0 |

Tổng hợp tháng (phần `renderAbove`): hàng `StatusSummaryCards`-kiểu: Tổng chi, Số giao dịch, rồi theo từng danh mục (card nhỏ: tên + số tiền). Không biểu đồ. Số tiền định dạng `Intl.NumberFormat('vi-VN')` như dashboard hiện có, canh phải, thêm đơn vị "đ". Tổng tính theo tháng (và danh mục nếu đang lọc).

### 3.3 Thói quen (/habits) (ĐÃ BỎ)

| Tác vụ | Luồng | Bước |
|---|---|---|
| Thêm | "Thêm thói quen", `Dialog` 1 ô tên, Lưu | 2 |
| Đánh dấu hôm nay / ngày khác | Click ô ngày trong lưới 7 ngày (bấm lại để bỏ) | 1 |
| Sửa tên | Menu dòng, Sửa, `Dialog`, Lưu | 3 |
| Xoá | Menu dòng, Xoá, `useConfirm` (nêu rõ xoá cả lịch sử) | 3 |
| Xem chuỗi | "Chuỗi hiện tại N ngày", "Dài nhất M ngày" hiển thị sẵn | 0 |
| Tìm | Ô tìm theo tên | 1 |

Quy tắc chuỗi (cần xác nhận, câu hỏi 4): chuỗi hiện tại = số ngày liên tiếp đã đánh dấu tính đến hôm nay; hôm nay chưa đánh dấu mà hôm qua có thì chưa đứt.

### 3.4 Ghi chú (/notes) (ĐÃ BỎ)

| Tác vụ | Luồng | Bước |
|---|---|---|
| Thêm | "Thêm mới", `FormLayout` (tiêu đề, nội dung), Lưu | 2 |
| Sửa / Xoá | Như Công việc | 2 / 3 |
| Tìm | Ô tìm của toolbar, kết quả đánh dấu từ khoá, hiện "N kết quả" | 1 |
| Lọc | Không có; sắp xếp mới nhất trước (`defaultSort: ['created_at:desc']`) | - |

## 4. Wireframe

Khung chung của mọi trang (kế thừa CMS): sidebar trái + header sticky (breadcrumb, hành động) + nội dung.

### 4.1 Dashboard

```
+-----------+-------------------------------------------------+
| (logo)    | Dashboard                                       |
| [Tìm menu]|                                                 |
| Dashboard | +----------------+ +----------------+           |
| Công việc | | Công việc      | | Chi tiêu T10   |           |
| Chi tiêu  | | 5 chưa xong    | | 3.250.000 đ    |           |
| Thói quen | | 1 quá hạn      | | 12 giao dịch   |           |
| Ghi chú   | | - Gửi báo cáo  | | [Xem chi tiêu] |           |
|           | | [Xem tất cả]   | +----------------+           |
| ---       | +----------------+ +----------------+           |
| File Mgr  | | Thói quen nay  | | Ghi chú gần đây|           |
| Hệ thống  | | [ ] Đọc sách 3 | | - Ý tưởng      |           |
|           | | [x] Chạy bộ  7 | | [Xem ghi chú]  |           |
+-----------+ +----------------+ +----------------+           |
```

Dùng `Card`/`CardHeader`/`CardTitle`/`CardContent` và lưới giống `dashboard.tsx` (1 cột mobile, 2 cột từ `md`). Mỗi card tải riêng với `Deferred` + `Skeleton` (đang tải), thẻ lỗi hiện `Alert` + nút "Thử lại" mà không chặn thẻ khác; rỗng: một câu + nút thêm. Checkbox thói quen ở dashboard bật/tắt hôm nay, nhãn truy cập "Đọc sách, hôm nay".

### 4.2 Công việc

```
Công việc                                      [+ Thêm mới]
[ Thêm công việc nhanh...                      ] [Thêm]
[Tìm kiếm...] [Bộ lọc] [Cột]                    (toolbar DataTable)
+--+--------------------+------+---------+--------------------+----+
|[]| Tiêu đề            | Ưu t.| Hạn     | Lark               | .. |
+--+--------------------+------+---------+--------------------+----+
|[]| Gửi báo cáo tuần   | Cao  | 28/10   | (Đã đồng bộ)       | .. |
|[]| Đặt lịch khám      | Vừa  | Quá hạn | (Lỗi) [Đồng bộ lại]| .. |
+--+--------------------+------+---------+--------------------+----+
Phân trang (Pagination)
```

Mobile: bảng cuộn ngang theo `Table` hiện có (header sticky); cột Ưu tiên/Hạn có thể ẩn qua menu "Cột" mặc định ẩn ở mobile. Task đã xong: chữ `muted-foreground`, gạch ngang. Hạn quá hạn: chữ "Quá hạn" kèm `destructive`.

### 4.3 Chi tiêu (ĐÃ BỎ)

```
Chi tiêu                                       [+ Thêm mới]
[<]  Tháng 10/2026  [>]
+-----------+-----------+-----------+-----------+
| Tổng chi  | Giao dịch | Ăn uống   | Đi lại    |  (cards)
| 3.250.000 | 12        | 1.500.000 | 700.000   |
+-----------+-----------+-----------+-----------+
[Tìm ghi chú...] [Bộ lọc]
Ngày       | Danh mục | Ghi chú  |      Số tiền | ..
27/10/2026 | (Ăn uống)| Cơm trưa |      55.000 đ| ..
```

### 4.4 Thói quen (ĐÃ BỎ)

```
Thói quen                                [+ Thêm thói quen]
[Tìm kiếm...]
+-----------------------------------------------------------+
| Đọc sách        T2  T3  T4  T5  T6  T7  CN(nay)   ...     |
| Chuỗi 3 ngày    [x] [x] [ ] [x] [x] [x] [ ]                |
| Dài nhất 9                                                 |
+-----------------------------------------------------------+
```

Mỗi thói quen là một `Card`. Ô ngày là `Toggle` (`aria-pressed`, nhãn "Đọc sách, thứ Hai 21/10, đã làm"); đã làm = nền `primary` + dấu tick (không chỉ dựa màu); ngày tương lai `disabled`. Mobile: tên + chuỗi ở trên, hàng 7 ô bên dưới, không cuộn ngang.

### 4.5 Ghi chú (ĐÃ BỎ)

```
Ghi chú                                        [+ Thêm mới]
[Tìm trong ghi chú...]
Tiêu đề              | Đoạn trích (cắt 1-2 dòng)  | Cập nhật  | ..
Ý tưởng dự án        | Một vài dòng đầu của ...   | 26/10     | ..
```

Form sửa: `FormLayout` một `Section` (Tiêu đề, Nội dung dạng `textarea` cao). Cảnh báo thay đổi chưa lưu nếu `FormLayout` đã hỗ trợ; nếu chưa thì không thêm (giữ phạm vi).

## 5. Trạng thái dùng chung (dùng cơ chế CMS)

- Đang tải: `Skeleton` cho card dashboard; bảng dùng hành vi tải sẵn của Inertia; nút lưu `disabled` + `Spinner`.
- Rỗng: `DataTable.emptyMessage` ("Chưa có công việc nào." v.v.); kết quả tìm rỗng: "Không tìm thấy kết quả." và hướng dẫn xoá bộ lọc.
- Lỗi form: `InputError`/`errorMsg` của `Field` cạnh từng ô; lỗi hệ thống: `Alert`/`alert-error`, nút "Thử lại".
- Thành công/thất bại thao tác: toast `sonner` qua `use-flash-toast`.
- Xoá: `useConfirm` (`ConfirmDialog`), nêu tên mục; không undo.

## 6. Design system: kế thừa, không tạo mới

Dùng token và component nguyên trạng. Tóm tắt giá trị CMS đang dùng (xem front matter):

- Font Instrument Sans; nền `#FAFAFA`; card trắng, viền 1px `#E4E4E7`, `shadow-none`; bán kính 4px; màu nhấn `#2F6FED`; lỗi `#E5484D`.
- Button: `Button` các variant `default`, `outline`, `secondary`, `ghost`, `destructive`; cỡ `default` 36px, `sm`, `xs`, `icon`.
- Form: `Field` (label luôn hiển thị phía trên, lỗi cạnh ô), `Input`, `Select`/`InputSelect`, `Checkbox`, `Switch`.
- Khác: `Table` (header sticky, nền muted), `Badge`, `Card`, `Dialog`, `AlertDialog`, `Tooltip`, `Tabs`, `Skeleton`, `Spinner`, `Pagination`.

Component mới duy nhất cần dựng, theo đúng token trên (đặt trong `resources/js/components/`): (1) lưới đánh dấu ngày thói quen, (2) badge/nút trạng thái Lark (ghép từ `Badge` + `Button`), (3) ô thêm nhanh công việc (ghép `Input` + `Button`), (4) khối tổng hợp tháng chi tiêu (ghép `Card`/`StatusSummaryCards`).

## 7. Responsive

Theo CMS: sidebar thu icon/offcanvas dưới breakpoint mobile; header hành động tự xuống dòng; bảng cuộn ngang; lưới dashboard 1 cột, 2 cột từ `md`. Không thêm breakpoint riêng. Lưới thói quen và thẻ tổng hợp chi tiêu xếp 2 cột trên mobile (`grid-cols-2`), không tràn ngang ở 320px. Vùng chạm ô thói quen và checkbox >= 40px trên mobile (CMS chưa đảm bảo vùng 44px cho mọi control; chỉ áp dụng cho component mới).

## 8. Accessibility

Kế thừa: skip link, `aria-current`, focus ring (`ring-[3px]` quanh `--ring`), nhãn cho control chỉ có icon. Bổ sung cho phần mới:
- Mọi input có label (`Field label`); lỗi liên kết với input.
- Badge Lark, "Quá hạn", ô thói quen đã làm: có chữ/icon, không chỉ màu.
- Ô thói quen: `aria-pressed` và nhãn đầy đủ; toast dùng vùng live (sonner).
- Dialog (Radix) bẫy focus, Esc đóng, trả focus; `useConfirm` focus mặc định ở nút Huỷ nếu CMS đã làm vậy (cần kiểm khi code).
- Contrast: ước tính, chưa đo bằng công cụ: chữ `primary` trên trắng và `muted-foreground` (#71717A) trên nền sáng sát ngưỡng 4.5:1; `destructive` (#E5484D) chữ nhỏ trên trắng có thể dưới 4.5:1, vì vậy văn bản lỗi nên dùng `foreground` kèm icon đỏ, hoặc QA đo và xử lý. Không sửa token CMS trong phạm vi này.

## 9. Reduced motion

Kế thừa: `Button` dùng `motion-reduce:transition-none`. Component mới (lưới thói quen, badge, card) không dùng animation; chuyển màu hover dùng `transition-colors motion-reduce:transition-none`. Không thêm hiệu ứng lặp.

## 10. Tiêu chí nghiệm thu

1. Sidebar có đủ 4 mục mới, mục hiện tại có `aria-current`; giao diện (font, màu, bán kính) trùng các trang CMS hiện có.
2. Mỗi trang danh sách dùng `DataTable` với tìm, lọc, sắp xếp, phân trang, xoá có xác nhận; thêm/sửa dùng `FormLayout`.
3. Thêm nhanh công việc bằng 1 Enter; task lưu được kể cả khi Lark lỗi; badge phản ánh 3 trạng thái; "Đồng bộ lại" cập nhật trạng thái hoặc hiện lỗi.
4. Tổng chi tiêu tháng/danh mục khớp với danh sách đang lọc; đổi tháng cập nhật cả hai.
5. Bấm ô ngày bật/tắt; chuỗi hiện tại và dài nhất đúng quy tắc 3.3.
6. Tìm ghi chú đúng tiêu đề/nội dung, có đánh dấu từ khoá, rỗng thì có trạng thái rỗng.
7. Dùng được bằng bàn phím; 320px không cuộn ngang ngoài bảng; reduced motion không có chuyển động mới.
8. Lark không xuất hiện ở Chi tiêu, Thói quen, Ghi chú.

## 11. Điểm cần người dùng quyết định

1. Dashboard: thay hẳn nội dung dashboard CMS bằng 4 card module (đề xuất), hay giữ card CMS/Analytics phía dưới?
2. Danh mục chi tiêu: danh sách cố định (đề xuất: Ăn uống, Đi lại, Nhà cửa, Sức khoẻ, Giải trí, Khác) hay tự tạo (thêm màn quản lý)? Chi tiêu chỉ ghi khoản chi hay cả thu nhập?
3. Đồng bộ Lark: tự động khi lưu (đề xuất) hay chỉ khi bấm nút? Sửa/hoàn thành/xoá task có đẩy sang Lark không?
4. Quy tắc chuỗi thói quen (3.3) và thói quen chỉ theo ngày.
5. Ghi chú: văn bản thuần với `textarea` (đề xuất) hay dùng `editor` rich-text có sẵn trong CMS?
6. Xoá cứng sau xác nhận (đề xuất) hay dùng thùng rác (CMS có `actions.trash`)?
7. Có giữ các mục CMS (Hệ thống, File Manager, Admin/Role...) hiển thị trong sidebar không, hay ẩn bớt vì chỉ một người dùng?
8. Tiền tệ VND, múi giờ `Asia/Ho_Chi_Minh`, định dạng ngày `dd/mm/yyyy`.
