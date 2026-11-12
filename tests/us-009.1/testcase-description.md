# Mô tả testcase US-009.1

| ID | Mục tiêu | Tiền điều kiện / dữ liệu | Bước thực hiện | Kết quả mong đợi | AC |
| --- | --- | --- | --- | --- | --- |
| US0091-ASYNC-01 | Xác nhận dispatch không chờ AI | Store tạm; evaluator bị chặn bằng Promise; input milestone `SAVE`, version `problem-1-v7` | Gọi `trigger`; chờ evaluator bắt đầu nhưng chưa mở khóa evaluator; kiểm tra assessment rồi mở khóa | `trigger` trả về trong khi assessment còn `PENDING`/`EVALUATING`; coverage ghi nhận snapshot và version; milestone/version được giữ chính xác | 13a, 13e |
| SCRUM-191 | Đánh giá theo thứ tự event | Ba event cùng workspace, sequence 1–3, gửi sequence 3 trước | Gửi sequence 3, sau đó sequence 1 và 2; đợi trạng thái kết thúc | Event 3 được giữ khi thiếu sequence; evaluator xử lý theo `[1, 2, 3]`; milestone save/run/submit được lưu | 13a, 13e |
| SCRUM-192 | Chống event trùng và giữ một active case | Evaluator trả về finding taxonomy hợp lệ, rationale và CODE/TEST evidence xác thực | Gửi cùng `eventId` hai lần; sau đó gửi event mới với snapshot khác | Retry trả cùng assessment; chỉ có một active case, episode đầu tiên; event mới nối thêm evidence; testcase lỗi được ánh xạ vào case | 13b, 13c |
| SCRUM-193 | Phục hồi sequence gap | Sequence 2 đến trước sequence 1 | Gửi sequence 2; kiểm tra trạng thái; gửi sequence 1 | Sequence 2 ở `PENDING` với `EVENT_SEQUENCE_GAP`; không gọi evaluator trước khi có sequence 1; sau đó cả hai được đánh giá theo thứ tự | 13e |
| SCRUM-194 | Khôi phục sau restart | Store có assessment ở trạng thái `EVALUATING` | Khởi tạo service mới trên store đó | Assessment được đưa lại vào queue và kết thúc; chỉ được evaluator xử lý một lần | 13e |
| US0091-EVIDENCE-01 | Không kết luận từ lỗi kỹ thuật hoặc evidence không hợp lệ | Runner trả `INTERNAL_ERROR` / `NETWORK_ERROR`, provider lỗi, và finding không thuộc taxonomy / trích dẫn code giả | Dispatch các assessment và chờ trạng thái cuối | Lỗi runner / mạng thành `INSUFFICIENT_EVIDENCE`; lỗi provider thành `FAILED`; finding không kiểm chứng thành `INSUFFICIENT_EVIDENCE`; không tạo case | 13b, 13c, 13d, 13e |

## Ghi chú đánh giá

- Các test dùng evaluator giả lập để kiểm tra state machine, deduplication, event ordering, evidence validation và persistence; không gọi model thật.
- Bộ testcase không đo thời gian phản hồi API hoặc trải nghiệm UI đầu-cuối; testcase async kiểm tra việc service trả assessment trước khi evaluator hoàn tất.
- Không thể đánh giá ngưỡng D-06 khi dataset, tiêu chí định lượng và cấu hình model thực tế chưa có trong repository. Không đánh dấu AC-13f là đạt dựa trên các test này.
