"use client";
import { useState, useEffect, useCallback } from "react";
import { applyApi } from "@/lib/api";
import type { OrchestratorState } from "@/types";

const POLL_MS = 2000;

const DEFAULT_STATE: OrchestratorState = {
  isRunning: false,
  phase: "idle",
  currentJobId: null,
  processed: 0,
  applied: 0,
  failed: 0,
  skipped: 0,
  startedAt: null,
};

export function usePipeline() {
  const [state, setState] = useState<OrchestratorState>(DEFAULT_STATE);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const s = await applyApi.status();
      setState(s);
    } catch {
      // backend may not be up yet — suppress
    }
  }, []);

  // Poll when running, slower when idle
  useEffect(() => {
    void refresh();
    const interval = setInterval(
      () => void refresh(),
      state.isRunning ? POLL_MS : 10000
    );
    return () => clearInterval(interval);
  }, [state.isRunning, refresh]);

  const start = useCallback(
    async (opts?: { platforms?: string[]; useAISearch?: boolean; maxApplications?: number }) => {
      setError(null);
      try {
        const res = await applyApi.start(opts);
        setState(res.state);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to start pipeline");
      }
    },
    []
  );

  const stop = useCallback(async () => {
    try {
      await applyApi.stop();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to stop");
    }
  }, [refresh]);

  const retry = useCallback(async () => {
    setError(null);
    try {
      await applyApi.retry();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to retry");
    }
  }, [refresh]);

  const scoreOnly = useCallback(async () => {
    setError(null);
    try {
      await applyApi.score();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to score");
    }
  }, []);

  return { state, error, start, stop, retry, scoreOnly, refresh };
}
