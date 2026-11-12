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

## Mô tả testcase

| Testcase                                       | Acceptance criteria | Nội dung / kết quả mong đợi                                                                                                                                                                                   |
| ---------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Submission 60 ngày và hint sau khi đóng cửa sổ | AC-16a, AC-16b      | Tạo bài lab, lưu và chạy code, mở hint và nộp bài; mô phỏng bản ghi đã tồn tại 60 ngày; đóng practice window; xác nhận student vẫn đọc được code, kết quả chạy, submission, assignment version và hint đã mở. |
| Tạo backup và kiểm tra checksum                | AC-16c (một phần)   | Tạo backup từ API; tính lại SHA-256 trên chính file; kiểm tra tham chiếu classroom/workspace hiện được backend xác minh; chạy API verify và đối chiếu kết quả.                                                |
| Khôi phục toàn bộ dữ liệu học kỳ               | AC-16c              | TODO: backend hiện chưa có API/luồng restore vào database sạch, nên chưa thể xác nhận phục hồi đầy đủ records và quan hệ.                                                                                     |
| Backup bị thiếu/hỏng phải báo lỗi              | AC-16c              | TODO: verifier hiện có đường xử lý trả kết quả thành công khi không đọc được file backup.                                                                                                                     |

Test mô phỏng tuổi bản ghi bằng cách đặt `acceptedAt` về 60 ngày trước; test này không
chờ thời gian thực 60 ngày và không thay thế diễn tập qua ranh giới đủ 4 tháng.

## Phát hiện lỗi / khoảng trống trong codebase

1. **Verify backup có thể báo thành công dù file không tồn tại hoặc không đọc/parse được.**
   Trong [`backend/backups.mjs`](../../backend/backups.mjs), `verifyBackupDisasterRecovery`
   bắt lỗi đọc/parse và đặt `verifiedChecksum = true`, sau đó vẫn có thể trả về
   `verified: true`. Trường hợp backup seed không có file cũng được mô phỏng là thành công.
   Đây là false positive trong disaster-recovery drill.
2. **Backup chưa bao phủ đủ dữ liệu thuộc phạm vi US-012.3.**
   [`backend/backups.mjs`](../../backend/backups.mjs) chỉ đưa `terms`, `classrooms`,
   `assignments`, `workspaces`, `submissions` và `alerts` vào payload. Đáng chú ý,
   immutable CodePulse submissions được lưu trong `submissions.json`, nhưng backup
   đọc `codepulse-submissions.json`; vì vậy payload hiện có thể bỏ sót chính các submission
   này. Backup cũng chưa gồm các
   file snapshots, assignment versions, memberships, labs, executions/judgments và
   activity/hint-progress. Vì vậy checksum hợp lệ không chứng minh toàn bộ hồ sơ học kỳ
   được giữ lại.
3. **Endpoint verify chỉ kiểm tra hash và một kiểu liên kết, không thực hiện restore.**
   Phần kiểm tra hiện chỉ xác nhận `workspace.classroomId` có classroom tương ứng; chưa
   kiểm tra quan hệ submission → assignment version → judgment/test result, và chưa
   phục hồi vào một database sạch. Do đó AC-16c và RPO/RTO theo D-07 chưa được chứng minh.
4. **Ranh giới lưu giữ đủ 4 tháng chưa được kiểm thử.**
   Test hiện kiểm tra trường hợp 60 ngày theo scenario; repository chưa có kiểm thử tiến
   thời gian qua 4 tháng hoặc xác nhận một chu kỳ lab 2 tuần không chạy cleanup.

Các mục TODO trong `.spec.ts` được đánh dấu rõ ràng để không tính là testcase đã pass.
