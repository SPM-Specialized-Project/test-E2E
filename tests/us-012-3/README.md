# US-012.3 — Semester Data Retention & Backup

Thư mục này chứa testcase tự động, hướng dẫn chạy và các phát hiện liên quan đến
việc lưu giữ dữ liệu CodePulse trong học kỳ.

## Nội dung

- [`retention-backup.spec.ts`](./retention-backup.spec.ts): kiểm thử tích hợp qua HTTP API, chạy backend với thư mục dữ liệu tạm.
- Các test tự dọn backend và dữ liệu tạm sau khi chạy; không thay đổi dữ liệu làm việc trong `backend/data`.

## Chạy testcase

Yêu cầu Node.js 20 trở lên và dependencies frontend đã được cài đặt:

```powershell
.\frontend\node_modules\.bin\vitest.cmd run --root . --config testcases\us-012-3-semester-data-retention\vitest.config.ts testcases\us-012-3-semester-data-retention\retention-backup.spec.ts
```

Chạy từ thư mục gốc repository. Bộ test dùng `vitest.config.ts` riêng để không khởi
động route generator của frontend; backend được khởi động trên cổng ngẫu nhiên và
dùng `BACKEND_DATA_DIRECTORY` riêng cho từng test.

Lưu ý: testcase khởi chạy `backend/server.mjs` tương đối với vị trí file test. Chạy
lệnh trên trong repository Scrum 82 sẽ kiểm thử backend Scrum 82. Kết quả bên dưới
là lần tích hợp với backend trong `SPM-frontend-fix-qa-findings-full-resolution`; khi
kiểm thử folder tổng hợp, cần đặt/copy testcase vào đúng cấu trúc trong folder đó
để test trỏ tới backend tổng hợp.

## Mô tả testcase

| Testcase | Acceptance criteria | Nội dung / kết quả mong đợi | Kết quả gần nhất |
| --- | --- | --- | --- |
| Submission 60 ngày và hint sau khi đóng cửa sổ | AC-16a, AC-16b | Tạo bài lab, lưu và chạy code, mở hint và nộp bài; mô phỏng bản ghi đã tồn tại 60 ngày; đóng practice window; xác nhận student vẫn đọc được code, kết quả chạy, submission, assignment version và hint đã mở. | PASS |
| Tạo backup và kiểm tra checksum | AC-16c (một phần) | Tạo backup qua API; xác minh SHA-256 trên file và các tham chiếu classroom/workspace mà verifier hỗ trợ. | PASS |
| Khôi phục dữ liệu và các liên kết | AC-16c | Tạo backup, xóa dữ liệu fixture, gọi API restore; xác nhận term, classroom, membership, assignment, workspace, submission, judgment, snapshot, execution, lab, alert và activity được khôi phục. | PASS |
| Backup có immutable submission | AC-16c | Xác nhận backup giữ immutable submission từ `submissions.json` và tách biệt collection CodePulse submissions. | PASS |
| Verify backup bị thiếu | AC-16c | Xóa file backup rồi xác minh; kết quả phải báo `verified: false`, không báo thành công giả. | PASS |
| Verify backup sai định dạng | AC-16c | Ghi JSON không hợp lệ vào file backup rồi xác minh; kết quả phải báo `verified: false`. | PASS |

Lần retest gần nhất trên `SPM-frontend-fix-qa-findings-full-resolution`
(2026-11-13 10:27): **6/6 test pass**. Bộ test Scrum 81 cũng đạt **6/6**;
các test backend hồi quy liên quan đạt **11/11**.

Test mô phỏng tuổi bản ghi bằng cách đặt `acceptedAt` về 60 ngày trước; test này không
chờ thời gian thực 60 ngày và không thay thế diễn tập qua ranh giới đủ 4 tháng.

## Kết quả và giới hạn còn lại

Các lỗi backup/restore trước đây về submission, restore API, và xác minh backup lỗi
đều đạt theo testcase hiện tại trên backend tổng hợp. Test xác nhận các collection
và liên kết đã nêu trong fixture; không phải kiểm kê mọi loại dữ liệu hoặc file trong
storage.

1. **Ranh giới lưu giữ đủ 4 tháng chưa được kiểm thử.**
   Test hiện kiểm tra trường hợp 60 ngày theo scenario; repository chưa có kiểm thử tiến
   thời gian qua 4 tháng hoặc xác nhận một chu kỳ lab 2 tuần không chạy cleanup.
