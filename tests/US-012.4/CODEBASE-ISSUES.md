# Các vấn đề trong codebase — US-012.4

## [Đã xử lý] Lỗi lưu ResetRecord khi hoàn tất reset

**Vị trí:** `backend\codepulse.mjs`, đoạn xử lý thực thi reset.

Handler chỉ chuyển term sang `RESETDONE` sau khi lưu bền vững `ResetRecord` trạng thái `COMPLETE`. Nếu lưu record hoàn tất thất bại, handler cố lưu record `INCOMPLETE` kèm lỗi, trả về `TERM_RESET_INCOMPLETE` và giữ term ở trạng thái `RESETTING`, để có thể thử lại. Nếu lần ghi record lỗi cũng thất bại, lỗi đó được ghi log; term vẫn không được xác nhận hoàn tất.

**Kiểm thử hồi quy:** Test AC-16e trong `semester-reset.spec.ts` mô phỏng lỗi ghi `COMPLETE`, xác nhận term giữ trạng thái `RESETTING`, record `INCOMPLETE` có thông tin lỗi được lưu, rồi xác nhận lần thử lại hoàn tất thành công.

## Ghi chú về phạm vi

Handler reset hiện đối soát workspaces, snapshots, submissions, legacy submissions, activities và executions. `problemBank` hiện được gán trực tiếp `true` thay vì lấy từ kết quả kiểm tra việc giữ lại dữ liệu. Model CodePulse hiện lưu tiến độ mở hint trong workspace và dữ liệu notification trong submission record. Bộ test này kiểm tra việc cô lập workspace/submission và giữ lại assignment version, nhưng chưa xác nhận các bảng `IssueCase`, `Notification` hoặc `Hint` độc lập nếu những bảng này được bổ sung sau.
