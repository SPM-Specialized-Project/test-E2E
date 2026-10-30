

## Chạy testcase

Mở terminal tại folder `frontend` rồi chạy:

```powershell
npx vitest run tests/run-code-sandbox
```

Chạy riêng một file:

```powershell
npx vitest run tests/run-code-sandbox/execution-verdicts.spec.ts
npx vitest run tests/run-code-sandbox/sandbox-isolation.spec.ts
```

## Nội dung testcase

- `execution-verdicts.spec.ts`: kiểm tra stdin và public tests, từ chối chọn hidden tests, giữ nguyên verdict do worker trả về, và quy đổi lỗi worker thành `INTERNAL_ERROR` mà không tính test Passed.
- `sandbox-isolation.spec.ts`: kiểm tra Docker arguments bật `--network=none`, giới hạn quyền và tài nguyên, đồng thời không mount đường dẫn host hoặc Docker socket.

Các spec này kiểm tra queue/configuration bằng unit test; chúng không khởi chạy Docker container để kiểm chứng hành vi runtime thực tế. Các testcase integration chạy sandbox thực có thể chạy từ repository root bằng:

```powershell
node --test backend/test/sandbox.test.mjs
```
