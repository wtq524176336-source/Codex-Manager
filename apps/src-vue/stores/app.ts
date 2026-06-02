import { defineStore } from "pinia";

import { bootstrapService } from "@/api/service";

type ServiceStatus = "idle" | "starting" | "ready" | "error";

interface AppState {
  serviceAddr: string;
  serviceError: string;
  serviceStatus: ServiceStatus;
}

export const useAppStore = defineStore("app", {
  state: (): AppState => ({
    serviceAddr: "",
    serviceError: "",
    serviceStatus: "idle",
  }),
  getters: {
    serviceReady: (state) => state.serviceStatus === "ready",
    serviceStarting: (state) => state.serviceStatus === "idle" || state.serviceStatus === "starting",
  },
  actions: {
    async bootstrap() {
      if (this.serviceStatus === "starting" || this.serviceStatus === "ready") {
        return;
      }

      this.serviceStatus = "starting";
      this.serviceError = "";
      try {
        const result = await bootstrapService();
        this.serviceAddr = result.addr;
        this.serviceStatus = "ready";
      } catch (error) {
        this.serviceStatus = "error";
        this.serviceError = error instanceof Error ? error.message : String(error || "服务启动失败");
      }
    },
  },
});
