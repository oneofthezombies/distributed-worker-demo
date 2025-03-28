import http from "k6/http";
import { check } from "k6";

const url = `http://localhost:3000/tasks/1/logs`;
const content = open("temp/task_log.txt");
const payload = JSON.stringify({
  kind: "stdout",
  index: 0,
  content,
});
const params = {
  headers: {
    "Content-Type": "application/json",
  },
  compression: "gzip",
};

export const options = {
  vus: 1000,
  duration: "30s",
};

export default function () {
  const res = http.post(url, payload, params);
  check(res, { "status is 200": (r) => r.status === 200 });
}
