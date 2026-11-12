# Mô tả testcase — US-012.2

## Tiền điều kiện

- Backend chạy được với Node.js và dữ liệu seed.
- Tài khoản kiểm thử: admin `admin@gmail.com` / `admin123`, student `student@gmail.com` / `student123`.
- Test tự khởi động backend trên port động và dùng thư mục dữ liệu tạm; không sửa dữ liệu backend hiện có.

## Testcase tự động

| ID | Mục tiêu | Các bước | Kết quả mong đợi | Trạng thái hiện tại |
|---|---|---|---|---|
| TC-0122-API-01 | Health metrics | Đăng nhập admin; gọi `GET /api/admin/operations/health`. | HTTP 200; queue counts, trạng thái worker, latency, error rate và timestamp có kiểu/định dạng hợp lệ. | Tự động |
| TC-0122-AUTH-01 | Chặn student | Student gọi health, trace và audit endpoints. | Tất cả trả HTTP 403. | Tự động |
| TC-0122-TRACE-01 | Truy vết request | Admin tra cứu ID mẫu; kiểm tra stage, timestamp và payload. | HTTP 200; trace có các stage RECEIVED, DISPATCHED, EXECUTED, RECORDED; source code/token/test ẩn đã che. | Tự động |
| TC-0122-TRACE-02 | Request ID không tồn tại | Admin tra cứu ID ngẫu nhiên chắc chắn không có trong dữ liệu. | Trả HTTP 404 / thông báo không tìm thấy, không tạo timeline giả. | Tự động; hiện fail do backend tạo synthetic trace |
| TC-0122-PRIV-01 | Che dữ liệu nhạy cảm trong audit | Ghi fixture audit chứa sentinel password, token, source code và hidden test; gọi audit API. | Response không chứa bất kỳ sentinel nào ở dạng rõ. | Tự động; hiện fail do `details` trả nguyên văn |
| TC-0122-AUDIT-01 | Audit chỉ đọc | Lấy một audit record; thử PUT và DELETE; đọc lại record. | PUT/DELETE bị từ chối; record không đổi. | Tự động |

`TC-0122-API-01` chỉ kiểm tra cấu trúc và kiểu dữ liệu, không chứng minh metrics là số liệu runtime. Hiện backend chưa có cách thiết lập queue/worker để xác minh con số 5 hoặc trạng thái offline qua API.

## Testcase UI thủ công

| ID | Mục tiêu | Các bước | Kết quả mong đợi |
|---|---|---|---|
| TC-0122-UI-01 | Hiển thị queue/worker | Đăng nhập admin, mở màn hình giám sát, tạo/giữ 5 execution chờ và mô phỏng worker offline. | Queue hiển thị 5; worker offline có cảnh báo và timestamp được cập nhật. |
| TC-0122-UI-02 | Request trace | Mở tab “Truy vết & Nhật ký kiểm toán”; tìm một request tồn tại rồi tìm ID không tồn tại. | ID hợp lệ hiển thị đầy đủ timeline; ID lạ hiển thị thông báo không tìm thấy, không hiển thị dữ liệu giả. |
| TC-0122-UI-03 | Không lộ dữ liệu | Kiểm tra trace và cột ghi chú audit với fixture có password/token/source code/hidden test sentinel. | Không sentinel nào xuất hiện dạng rõ trên màn hình. |
| TC-0122-UI-04 | Audit không có thao tác sửa/xóa | Kiểm tra bảng audit log và các menu/action của từng record. | Không có nút hoặc thao tác sửa/xóa record. |
| TC-0122-UI-05 | Student bị chặn | Đăng nhập student, thử mở route màn hình admin và gọi API tương ứng. | Không truy cập được; API trả HTTP 403. |

## Liên kết với yêu cầu

- AC-15a: TC-0122-API-01, TC-0122-UI-01.
- AC-15b: TC-0122-TRACE-01, TC-0122-TRACE-02.
- AC-15d: TC-0122-AUDIT-01 và TC-0122-UI-04.
- AC-15e: TC-0122-PRIV-01, TC-0122-UI-03.
- Phân quyền student: TC-0122-AUTH-01, TC-0122-UI-05.
- AC-15c chưa có API thay đổi cấu hình trong phạm vi màn hình hiện tại; cần testcase riêng khi API cấu hình được triển khai.
