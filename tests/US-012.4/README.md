# US-012.4 — Test case quy trình reset học kỳ

Thư mục này chứa các kiểm thử tích hợp và ghi nhận liên quan đến yêu cầu reset học kỳ. File spec kiểm thử API backend hiện có và hàng đợi thực thi; không bổ sung hoặc thay đổi hành vi của sản phẩm.

## Cách chạy

Chạy lệnh sau từ thư mục gốc của repository, với Node.js phiên bản 24 trở lên:

```powershell
node --test testcases\US-012.4\semester-reset.spec.ts
```

Backend được khởi chạy dưới dạng tiến trình con, sử dụng một cổng khả dụng và thư mục dữ liệu tạm. Các kiểm thử không chỉnh sửa dữ liệu trong `backend\data`.

## Mô tả test case

| Test case | Tiêu chí chấp nhận | Phạm vi kiểm thử |
| --- | --- | --- |
| Chỉ cho phép admin reset sau khi đến đúng thời điểm chuyển tiếp | AC-16d | Student không thể bắt đầu reset; admin bị từ chối trước `resetDate`. Sau thời điểm chuyển tiếp, term chuyển sang `RESETTING` và submission mới từ workspace bị từ chối với mã `TERM_RESET_IN_PROGRESS`. |
| Đối soát và ghi audit sau purge, đồng thời giữ lại phiên bản assignment có thể tái sử dụng | AC-16e, AC-16f | Lưu dữ liệu cá nhân vào workspace, thực hiện reset, kiểm tra workspace/snapshot đã được purge và số lượng bản ghi bị ảnh hưởng; xác minh người thực hiện, timestamp, kết quả đối soát trong audit; kiểm tra assignment versions vẫn còn. Đồng thời kiểm tra giảng viên xác nhận hoàn tất. |
| Chờ runner và tác vụ đánh giá đang chạy kết thúc trước khi purge | AC-16d | Giữ runner đang chạy trong khi reset drain term; kiểm tra run mới bị từ chối, drain chờ đến khi tác vụ hoàn tất và job đã nhận được ghi nhận là hoàn tất. |
| Chờ xử lý: không lưu được ResetRecord hoàn tất | AC-16e | Ghi nhận lỗi về thứ tự cập nhật trạng thái/audit trong `CODEBASE-ISSUES.md`. Test được đánh dấu `todo` cho đến khi luồng lỗi này được xử lý an toàn. |

## Ghi nhận liên quan

Xem [CODEBASE-ISSUES.md](./CODEBASE-ISSUES.md) để biết lỗi nhất quán giữa trạng thái hoàn tất reset và audit đã phát hiện khi rà soát. Các test backend hiện có trong `backend\test` được giữ nguyên.
