# Trợ lý AI (module Laravel + sidebar phải)

## Context

Cần một trợ lý trong app: gọi LLM (Claude, OpenAI/Codex, Gemini, DeepSeek) qua API key và qua CLI (`claude`, `codex`, `gemini`); soạn nháp trả lời khách (người duyệt rồi mới gửi); thống kê/báo cáo (trang trong app + gửi Zalo/Messenger/Telegram theo lịch); viết bài nháp và lên lịch ở `/posts`. Giao diện: **chỉ một sidebar AI bên phải**, không thêm mục vào menu trái. Đã chốt: soạn nháp rồi duyệt, không tự gửi.

## Cách tiếp cận

`providers.ai` đã có trong `config/integrations.php` (active=false). Mở rộng nó, không tạo hệ thống mới.

### 1. Cấu hình kết nối

- `config/integrations.php` → `ai`: `active => true`, `test => 'ai'`; secrets `anthropic_key`, `openai_key`, `gemini_key`, `deepseek_key` (không bắt buộc); fields `vendor` (+ `deepseek`), `model`, `mode` (api|cli), `report_conversation_id`. Permission `auto_send` giữ mặc định tắt và không nối vào code gửi.
- `ConfiguredIntegrationProvider::test()`: thêm nhánh `ai` (gọi nhẹ tới vendor, thông báo cố định, không lộ key/URL), theo mẫu `testTelegram()`.

### 2. Lớp LLM — `app/Services/Ai/`

- `LlmClient` (`complete(string $system, string $prompt): string`); client API dùng `Http::timeout()->connectTimeout()`: `AnthropicClient`, `OpenAiClient`, `GeminiClient`, `DeepSeekClient`; `CliLlmClient` dùng `Process` với mảng argv (không chuỗi shell), prompt qua stdin, timeout và thư mục làm việc cố định.
- `AiAssistant` chọn client theo `Integration` `ai`; lỗi bọc bằng `AiException` với thông báo cố định. Nội dung chat là dữ liệu không tin cậy: đặt trong khối riêng của prompt, CLI không được dùng công cụ ghi/chạy lệnh.

### 3. Soạn nháp trả lời khách

- `POST chat/{conversation}/suggest` (quyền `conversations.reply`) trong `ChatController`: lấy ~20 tin gần nhất, trả JSON `{draft}`, gọi đồng bộ có timeout.
- Nháp không lưu thành `ChatMessage`; điền vào `draft` của `resources/js/pages/chat/index.tsx` (nút "Gợi ý AI" cạnh `components/chat/composer.tsx`). Người dùng sửa và gửi qua `chat.send` có sẵn.

### 4. Thống kê và báo cáo

- `ReportBuilder`: đếm tin vào/ra theo kênh, hội thoại chưa đọc, bài đã đăng/lên lịch/lỗi trong khoảng ngày (`PersonalClock`); AI chỉ viết phần tóm tắt từ số liệu đã tính.
- Lệnh `ai:send-report`, đăng ký `Schedule::command('ai:send-report')->dailyAt('08:00')->withoutOverlapping()` trong `routes/console.php`; gửi qua `ChatChannels::sender($provider)->send(...)` tới hội thoại `report_conversation_id`. Telegram cần hội thoại đã có (không có owner chat_id riêng).

### 5. Viết bài nháp

- `POST ai/post-draft`: nhận ý tưởng + nền tảng, trả nội dung; frontend điền vào `resources/js/pages/posts/form.tsx`. Lên lịch dùng cơ chế `posts:publish-due` sẵn có, AI không tự đăng.

### 6. Sidebar AI bên phải

- `resources/js/layouts/app/app-sidebar-layout.tsx`: panel phải (`Sidebar side="right"` trong `components/ui/sidebar.tsx`, hoặc `SidebarProvider` lồng), nút mở trong `SiteHeader`; component mới `components/ai/ai-panel.tsx` (chat với trợ lý, nút "Báo cáo hôm nay"). `POST ai/ask` cho hỏi đáp tự do (quyền `ai.use`).
- Quyền: tài nguyên mới `ai` (`config/views.php`, `GeneratePermissionsCommand`).

## File chính

`config/integrations.php`, `ConfiguredIntegrationProvider.php`, `app/Services/Ai/*` (mới), `ChatController.php`, `AiController.php` (mới), `routes/web.php`, `routes/console.php`, `app-sidebar-layout.tsx`, `components/ai/ai-panel.tsx` (mới), `pages/chat/index.tsx`, `pages/posts/form.tsx`, `tests/Feature/Ai/*` (mới).

## Kiểm chứng

- PHPUnit: `Http::fake` từng vendor (thành công, 401, timeout), `Process::fake` cho CLI, route suggest (quyền, không tạo `ChatMessage`), `ai:send-report` (số liệu đúng, sender giả), key không lộ trong response/log.
- `pint`, `prettier`; mở panel phải và nút Gợi ý AI trên trình duyệt.
- Không có migration mới; key chỉ nhập qua trang Tích hợp.

## Rủi ro / giới hạn

- CLI chỉ chạy khi máy bật và đã đăng nhập; không dùng cho báo cáo nền nếu máy tắt.
- Chưa tự gửi tin cho khách; bật `auto_send` là việc riêng, cần yêu cầu sau.
