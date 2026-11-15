# US-009.1 - AI-Powered Issue Detection

Thư mục này chứa bộ testcase TypeScript cho luồng phát hiện vấn đề học tập có bằng chứng kiểm chứng được.

## Chạy testcase

Yêu cầu Node.js 22.6 trở lên (đã hỗ trợ chạy TypeScript có thể xóa kiểu). Từ thư mục gốc repo, chạy:

```powershell
node --test testcases\us-009.1\issue-detection.spec.ts
```

Test dùng runner `node:test` hiện có trong backend, gọi trực tiếp `createIssueDetectionService` với store JSON tạm và evaluator giả lập; không gọi AI provider thật, không cần server ngoài, và tự dọn dữ liệu tạm sau mỗi test.

## Phạm vi

- Dispatch bất đồng bộ và chốt đúng milestone / assignment version.
- SCRUM-191: thứ tự event theo workspace.
- SCRUM-192: idempotency và gom evidence vào một active case.
- SCRUM-193: giữ event khi thiếu sequence và tiếp tục sau khi lấp gap.
- SCRUM-194: phục hồi assessment đang `EVALUATING` sau khi service khởi động lại.
- Evidence hợp lệ, ánh xạ testcase liên quan, và phân biệt lỗi runner / lỗi provider / thiếu evidence.

Chi tiết tiền điều kiện, bước thực hiện, kết quả mong đợi và liên kết acceptance criteria nằm trong [testcase-description.md](./testcase-description.md).

## Giới hạn đã biết

AC-13f chưa thể được xác nhận bằng bộ testcase này: repository chưa có dataset đánh giá độc lập D-06, ngưỡng định lượng, hoặc cấu hình model triển khai. Các evaluator giả lập chỉ kiểm tra logic backend và không phải bằng chứng về chất lượng model.

Không phát hiện lỗi chức năng chắc chắn trong luồng issue detection đã khảo sát. Đây là ghi chú về giới hạn xác minh, không phải kết luận rằng AC-13f đã đạt.

## Ghi chú lỗi từ bộ backend hiện có

Lệnh `npm --prefix backend test` trong lần xác minh này không đạt: 23/46 test pass và 23 fail. Nhóm sandbox trả `INTERNAL_ERROR` với thông báo sandbox/worker không khả dụng; các failure khác được ghi nhận ở assignment/practice-window (kết quả đếm thực tế `0` thay vì `1`), kiểm tra output trong `run-code.test.mjs`, và tích hợp Gitea. Đây là các failure ngoài bộ US-009.1 này; chưa được phân loại nguyên nhân và không được chỉnh sửa trong phạm vi testcase.
