# Các vấn đề trong codebase — US-012.4

## [Mức độ cao] Reset có thể báo lỗi dù term đã được đánh dấu hoàn tất

**Vị trí:** `backend\codepulse.mjs`, đoạn xử lý thực thi reset, khoảng dòng 1230–1237.

Handler ghi bền vững trạng thái term thành `RESETDONE` trước khi ghi thêm `ResetRecord` trạng thái `COMPLETE`. Nếu thao tác ghi file reset record thất bại, request trả về lỗi nhưng term vẫn ở trạng thái `RESETDONE`; đồng thời không có record `INCOMPLETE` vì bước lưu này nằm ngoài phần xử lý lỗi purge. Điều này vi phạm AC-16e: không được xác nhận hoàn tất nếu audit record chưa được lưu thành công, và lỗi phải được đánh dấu là chưa hoàn tất.

**Đề xuất xử lý:** Đảm bảo việc hoàn tất reset và lưu audit record có thể phục hồi như một giao dịch. Không chuyển sang `RESETDONE` nếu record `COMPLETE` chưa được lưu bền vững; khi có lỗi, giữ trạng thái có thể thử lại/chưa hoàn tất và ghi nhận lỗi nếu có thể.

**Kiểm thử hồi quy:** Test cho nhánh lỗi tương ứng hiện được đánh dấu `todo` trong `semester-reset.spec.ts`; cần bật test sau khi sửa luồng xử lý.

## Ghi chú về phạm vi

Handler reset hiện đối soát workspaces, snapshots, submissions, legacy submissions, activities và executions. `problemBank` hiện được gán trực tiếp `true` thay vì lấy từ kết quả kiểm tra việc giữ lại dữ liệu. Model CodePulse hiện lưu tiến độ mở hint trong workspace và dữ liệu notification trong submission record. Bộ test này kiểm tra việc cô lập workspace/submission và giữ lại assignment version, nhưng chưa xác nhận các bảng `IssueCase`, `Notification` hoặc `Hint` độc lập nếu những bảng này được bổ sung sau.
