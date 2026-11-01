# Lumina CMS

Template CMS dùng Laravel 13, React 19 và Inertia 3. Dự án tích hợp sẵn giao diện quản trị, xác thực, quản lý admin, phân quyền, quản lý file, trình soạn thảo nội dung và nhật ký hoạt động.

Code CMS nằm trực tiếp trong `app/` và `resources/js/`.

## Yêu cầu

- PHP 8.3 trở lên và Composer 2.
- Node.js phù hợp với Vite Plus: `^20.19.0`, `^22.18.0` hoặc `>=24.11.0`; pnpm (cần có trong `PATH` trước khi tạo dự án).
- Git.
- SQLite cho cấu hình mặc định; có thể cấu hình database khác trong `.env`.

## Bắt đầu nhanh

### Tạo dự án bằng Laravel Installer

Cài Laravel Installer nếu chưa có, rồi đăng ký repository Composer. Chỉ cần thực hiện một lần trên mỗi máy:

```bash
composer global require laravel/installer
composer config --global repositories.lumina-cms vcs git@github.com:0132E282/lumina-cms.git
```

Tạo và chạy dự án:

```bash
laravel new my-app --using=lumina/cms
cd my-app
php artisan db:seed
composer run dev
```

Composer chọn phiên bản phù hợp từ repository; nếu cần code mới nhất trên `main`, dùng cách clone bên dưới.

Trong quá trình tạo dự án, Composer cài dependency PHP; các hook của template tạo `APP_KEY`, file SQLite, chạy migration và `pnpm install`.

Nếu Laravel Installer hỏi chạy `npm install` và `npm run build`, chọn **No** vì dependency frontend đã được cài bằng pnpm. Khi phát triển local, `composer run dev` chạy Vite nên không cần build trước.

Nếu dùng database khác SQLite, sửa `.env` và chạy `php artisan migrate` trước khi seed.

### Clone repository template

Dùng cách này để phát triển trực tiếp trên code của template:

```bash
git clone git@github.com:0132E282/lumina-cms.git
cd lumina-cms
composer run setup
php artisan db:seed
composer run dev
```

`composer run setup` cài dependency PHP và frontend, tạo `.env` nếu thiếu, tạo `APP_KEY`, tạo file SQLite nếu thiếu và chạy migration.

Lệnh setup tạo lại `APP_KEY` mỗi lần chạy. Với dự án đã có dữ liệu, hãy chạy riêng các bước cần cập nhật: `composer install`, `pnpm install` và `php artisan migrate`.

## Đăng nhập admin

Mở `http://localhost:8000` sau khi chạy môi trường phát triển.

Seeder tạo admin từ `config('cms.system_admin')`, mặc định:

- Email: `admin@admin.com`
- Mật khẩu: `admin@admin.com`

Để chọn email khác, thêm vào `.env` trước khi chạy `php artisan db:seed`:

```dotenv
SYSTEM_ADMIN=admin@example.com
```

Có thể khai báo nhiều email, ngăn cách bằng dấu phẩy. Với mỗi admin mới, seeder đặt mật khẩu bằng email; tài khoản đã tồn tại được giữ nguyên. Đổi mật khẩu sau lần đăng nhập đầu tiên và trước khi đưa hệ thống vào sử dụng.

## Phát triển và kiểm tra code

```bash
composer run dev          # chạy môi trường phát triển
composer run lint         # format PHP bằng Pint
composer run lint:check   # kiểm tra format PHP
composer run types:check  # phân tích PHP bằng PHPStan/Larastan
pnpm run format          # format file đang thay đổi bằng Prettier
pnpm run format:check    # kiểm tra format file đang thay đổi bằng Prettier
pnpm run format:all      # chỉ dùng khi muốn format toàn dự án
pnpm run check           # kiểm tra frontend bằng Vite Plus
pnpm run check:fix       # áp dụng các sửa lỗi frontend tự động
pnpm run types:check     # kiểm tra TypeScript
pnpm run build           # build frontend
```

`composer run setup` và hook tạo dự án chỉ cài dependency frontend; chạy `pnpm run build` khi cần assets đã build.

Thư mục `tests/` hiện đã được xóa. Các script `composer run test` và `composer run ci:check` vẫn gọi bộ chạy test trong `composer.json`; cần khôi phục bộ test hoặc cập nhật các script này trước khi dùng làm kiểm tra CI.

## Xử lý lỗi thường gặp

- **Cấu hình `.env` chưa có hiệu lực:** chạy `php artisan config:clear`, rồi thử lại.
- **Setup báo thiếu pnpm:** bảo đảm `pnpm --version` chạy được trong cùng terminal trước khi chạy setup hoặc tạo dự án.
