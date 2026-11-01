"use client";

import { useSyncExternalStore } from "react";
import { DEFAULT_WECHAT_QR_ENVIRONMENT, isWeChatQrEnvironment, type WeChatQrEnvironment } from "@/lib/wechat-qr";

const STORAGE_KEY = "spatial-memory.wechat-qr.environment";
const CHANGE_EVENT = "spatial-memory:wechat-qr-environment";
let memoryEnvironment = DEFAULT_WECHAT_QR_ENVIRONMENT;
let memoryOnly = false;

function getSnapshot(): WeChatQrEnvironment {
  if (memoryOnly) return memoryEnvironment;
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return isWeChatQrEnvironment(value) ? value : DEFAULT_WECHAT_QR_ENVIRONMENT;
  } catch {
    return memoryEnvironment;
  }
}

function getServerSnapshot() {
  return DEFAULT_WECHAT_QR_ENVIRONMENT;
}

function subscribe(onChange: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === STORAGE_KEY) {
      memoryOnly = false;
      onChange();
    }
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

function setEnvironment(environment: WeChatQrEnvironment) {
  memoryEnvironment = environment;
  try {
    window.localStorage.setItem(STORAGE_KEY, environment);
    memoryOnly = false;
  } catch {
    // Storage may be blocked; keep the preference for this page session.
    memoryOnly = true;
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/** Same-tab and cross-tab updates, with a stable release snapshot during SSR. */
export function useWeChatQrEnvironment() {
  const environment = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return [environment, setEnvironment] as const;
}
