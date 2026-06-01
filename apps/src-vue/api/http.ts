import axios from "axios";

export const http = axios.create({
  timeout: 30000,
});

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (typeof error === "string" && error.trim()) {
    return error;
  }
  return "请求失败";
}
