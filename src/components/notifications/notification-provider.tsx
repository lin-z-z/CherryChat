"use client";

import { X } from "lucide-react";
import { Toast } from "radix-ui";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";

type NotificationTone = "error" | "info" | "success";

interface NotificationInput {
  message: string;
  tone?: NotificationTone;
}

interface NotificationRecord extends Required<NotificationInput> {
  id: number;
}

interface NotificationContextValue {
  notify: (notification: NotificationInput) => void;
}

const NotificationContext = createContext<NotificationContextValue | null>(
  null,
);

export function NotificationProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const nextId = useRef(0);
  const [notifications, setNotifications] = useState<NotificationRecord[]>([]);
  const notify = useCallback((notification: NotificationInput) => {
    const id = ++nextId.current;
    setNotifications((current) => [
      ...current,
      { id, message: notification.message, tone: notification.tone ?? "info" },
    ]);
  }, []);
  const value = useMemo(() => ({ notify }), [notify]);

  return (
    <NotificationContext.Provider value={value}>
      <Toast.Provider
        duration={5_000}
        label={t("notifications")}
        swipeDirection="right"
      >
        {children}
        {notifications.map((notification) => (
          <Toast.Root
            className="notification-toast"
            data-tone={notification.tone}
            key={notification.id}
            onOpenChange={(open) => {
              if (!open) {
                setNotifications((current) =>
                  current.filter(({ id }) => id !== notification.id),
                );
              }
            }}
            open
          >
            <Toast.Description>{notification.message}</Toast.Description>
            <Toast.Close asChild>
              <button aria-label={t("dismiss")} type="button">
                <X aria-hidden="true" className="size-4" />
              </button>
            </Toast.Close>
          </Toast.Root>
        ))}
        <Toast.Viewport
          aria-label={t("notifications")}
          className="notification-viewport"
        />
      </Toast.Provider>
    </NotificationContext.Provider>
  );
}

export function useNotifications(): NotificationContextValue {
  const value = useContext(NotificationContext);
  if (!value) {
    throw new Error(
      "useNotifications must be used inside NotificationProvider",
    );
  }
  return value;
}
