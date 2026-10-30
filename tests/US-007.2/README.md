



  ```powershell
  npm install --prefix backend
  npm ci --prefix frontend
  ```



Chạy các test backend unit tập trung vào lưu history, snapshot, output và metrics:

```powershell
node --test backend/test/executions.test.mjs
```

Chạy các test API, workspace history và access control (một số tình huống cần Docker):

```powershell
node --test backend/test/run-code.test.mjs backend/test/lab-session.test.mjs backend/test/authorization.test.mjs
```

Chạy test component frontend liên quan đến console, history và draft editor:

```powershell
Set-Location frontend
npx vitest run 'src/features/~_private/~course/~$id/components/execution-panel.test.tsx' 'src/features/~_private/~course/~$id/components/student-lab-workspace.test.tsx'
Set-Location ..
```

Chạy file `.spec.ts` trong thư mục testcase (thực hiện từ thư mục `frontend`):

```powershell
npx vitest run testcases/US-007.2/us-007.2.spec.ts
```

Chạy toàn bộ test backend:

```powershell
npm run backend:test
```

Chạy toàn bộ test frontend:

```powershell
Set-Location frontend
npx vitest run
Set-Location ..
```

