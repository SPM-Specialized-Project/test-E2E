# US-012.2 — Admin Operations & System Health Dashboard

Thư mục này gom testcase cho UI-09 và các API backend liên quan. Test được viết bằng Vitest và khởi chạy backend trong một thư mục dữ liệu tạm biệt lập.

## Chạy testcase

Từ thư mục gốc repository, sau khi đã cài dependencies frontend:

```powershell
npm exec --yes --package=vitest@3.0.8 -- vitest run tests\US-012.2-admin-operations\admin-operations.spec.ts
```

Test dùng tài khoản seed trong backend:

- Admin: `admin@gmail.com` / `admin123`
- Student: `student@gmail.com` / `student123`

Các testcase được viết theo acceptance criteria. Có testcase hiện **fail** vì phát hiện hành vi chưa đáp ứng; chi tiết nằm trong phần “Lỗi/điểm chưa đáp ứng” bên dưới.

Lần chạy hiện tại: **4 passed, 2 failed**. Hai testcase fail là TC-0122-TRACE-02 (unknown request ID trả HTTP 200 kèm trace giả) và TC-0122-PRIV-01 (audit `details` làm lộ sentinel nhạy cảm).

## Phạm vi

- Health API: cấu trúc metrics, timestamp, worker và queue counts.
- Quyền truy cập: student bị từ chối.
- Request trace: lifecycle, redaction và request ID không tồn tại.
- Audit log: dữ liệu nhạy cảm không bị lộ, API không cho sửa/xóa.
- Các bước kiểm tra UI thủ công được liệt kê trong [testcase-description.md](./testcase-description.md).

## Lỗi/điểm chưa đáp ứng:

1. **Request ID không tồn tại vẫn nhận trace giả:** [`backend/admin-operations.mjs`](../../backend/admin-operations.mjs) tạo synthetic trace với các mốc giả khi không tìm thấy trace/execution. Vì vậy UI không thể hiện chính xác “Request ID Not Found”; testcase tương ứng sẽ fail.
2. **Metrics không phản ánh queue/worker thực tế:** [`backend/routes.mjs`](../../backend/routes.mjs) gọi health provider không truyền queue stats. [`backend/admin-operations.mjs`](../../backend/admin-operations.mjs) trả về queue AI bằng `0`, tổng worker cố định là `4`, và trạng thái pool cố định `HEALTHY`. UI còn dùng dữ liệu mặc định trông như healthy khi request lỗi tại [`frontend/src/features/~_private/~system-monitoring/~index.tsx`](../../frontend/src/features/~_private/~system-monitoring/~index.tsx). Không có nguồn để xác nhận queue dài 5 tác vụ hoặc worker offline.
3. **Redaction chưa bao phủ audit details:** trace redaction chỉ xử lý một số key trực tiếp như `sourceCode`, `password`, `token` và các test case ẩn; audit API/UI hiển thị `details` nguyên trạng. Test đưa chuỗi bí mật vào fixture audit để xác nhận vấn đề.
4. **Audit log chưa append-only theo nghĩa bất biến:** [`backend/admin-operations.mjs`](../../backend/admin-operations.mjs) chỉ giữ tối đa 200 bản ghi và ghi lại toàn bộ file, nên các bản ghi cũ có thể bị loại bỏ. API hiện không có route sửa/xóa audit record, nhưng điều đó chưa đảm bảo lịch sử append-only.
5. **Quyền lecturer rộng hơn mô tả tùy chọn:** [`backend/routes.mjs`](../../backend/routes.mjs) cấp quyền toàn bộ `/api/admin/*` cho lecturer, coordinator và chairman, bao gồm cả tra cứu trace/audit và cập nhật trạng thái alert. Cần xác nhận đây có phải chủ ý hay lecturer chỉ nên xem chỉ báo availability.


